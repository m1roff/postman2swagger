#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const postmanToOpenApi = require('postman-to-openapi');
const yaml = require('js-yaml');

if (process.argv.length !== 5) {
    console.error('Usage: node converter.js <apiKey> <collectionId> <outputFile>');
    process.exit(1);
}

const apiKey = process.argv[2];
const collectionId = process.argv[3];
const outputFile = process.argv[4];

const outputDir = path.dirname(outputFile);
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// Standard HTTP headers that are not API-specific — not marked required
const STANDARD_HEADERS = new Set([
    'connection', 'accept', 'accept-encoding', 'accept-language',
    'cache-control', 'pragma', 'user-agent', 'referer', 'origin',
    'host', 'upgrade-insecure-requests', 'content-length',
]);

function fetchCollection(apiKey, collectionId) {
    return new Promise((resolve, reject) => {
        const url = `https://api.getpostman.com/collections/${collectionId}`;
        console.log('Fetching collection from Postman API...');
        https.get(url, { headers: { 'X-Api-Key': apiKey } }, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }
                const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                console.log(`Loaded: ${json.collection?.info?.name}`);
                resolve(json.collection);
            });
        }).on('error', reject);
    });
}

// Replace literal \n sequences with actual newlines recursively
function fixNewlines(obj) {
    if (typeof obj === 'string') return obj.replace(/\\n/g, '\n');
    if (Array.isArray(obj)) return obj.map(fixNewlines);
    if (obj && typeof obj === 'object') {
        for (const key of Object.keys(obj)) obj[key] = fixNewlines(obj[key]);
    }
    return obj;
}

// Collect non-standard non-disabled header names from all requests in collection
function extractRequiredHeaders(collection) {
    const headers = new Set();

    function walk(items) {
        for (const item of items || []) {
            if (item.item) {
                walk(item.item);
            } else if (item.request?.header) {
                for (const h of item.request.header) {
                    if (h.disabled) continue;
                    const key = h.key.toLowerCase();
                    if (!STANDARD_HEADERS.has(key)) {
                        headers.add(key);
                    }
                }
            }
        }
    }

    walk(collection.item);
    return headers;
}

function loadConfig(outputDir) {
    for (const name of ['swagger.config.yaml', 'swagger.config.yml', 'swagger.config.json']) {
        const p = path.join(outputDir, name);
        if (!fs.existsSync(p)) continue;
        const content = fs.readFileSync(p, 'utf8');
        const config = name.endsWith('.json') ? JSON.parse(content) : yaml.load(content);
        console.log(`Config loaded: ${name}`);
        return config;
    }
    return {};
}

function extractCollectionVariables(collection) {
    const vars = {};
    const raw = collection.variable || [];

    if (raw.length) {
        console.log('Collection variables from Postman API:');
        for (const v of raw) {
            const display = v.value !== undefined && v.value !== '' ? v.value : '(empty)';
            console.log(`  {{${v.key}}} = ${display}`);
        }
    }

    for (const v of raw) {
        if (v.key && v.value !== undefined && v.value !== '') {
            vars[`{{${v.key}}}`] = String(v.value);
        }
    }
    return vars;
}

function applyReplacements(obj, replacements) {
    if (typeof obj === 'string') {
        // Full match: if entire value is a variable, try to parse replacement as JSON
        if (replacements[obj] !== undefined) {
            try { return JSON.parse(replacements[obj]); } catch { return replacements[obj]; }
        }
        // Partial match: string substitution
        let result = obj;
        for (const [from, to] of Object.entries(replacements)) {
            result = result.split(from).join(to);
        }
        return result;
    }
    if (Array.isArray(obj)) return obj.map(item => applyReplacements(item, replacements));
    if (obj && typeof obj === 'object') {
        for (const key of Object.keys(obj)) obj[key] = applyReplacements(obj[key], replacements);
    }
    return obj;
}

// Apply collection variables prefixed with "openapi." as direct path assignments in the doc
function applyOpenApiVars(openApiDoc, rawVars) {
    const applied = [];
    for (const v of rawVars || []) {
        if (!v.key || !v.key.startsWith('openapi.')) continue;
        const segments = v.key.slice('openapi.'.length).split('.');
        let obj = openApiDoc;
        for (let i = 0; i < segments.length - 1; i++) {
            if (obj[segments[i]] === null || typeof obj[segments[i]] !== 'object') {
                obj[segments[i]] = {};
            }
            obj = obj[segments[i]];
        }
        const last = segments[segments.length - 1];
        try { obj[last] = JSON.parse(v.value); } catch { obj[last] = v.value; }
        applied.push(`${v.key} -> ${v.value}`);
    }
    if (applied.length) console.log(`OpenAPI vars applied:\n  ${applied.join('\n  ')}`);
    return openApiDoc;
}

// Mark collected headers as required in the OpenAPI document
function applyRequiredHeaders(openApiDoc, requiredHeaders) {
    if (!requiredHeaders.size) return openApiDoc;

    for (const pathItem of Object.values(openApiDoc.paths || {})) {
        for (const operation of Object.values(pathItem)) {
            if (!operation?.parameters) continue;
            for (const param of operation.parameters) {
                if (param.in === 'header' && requiredHeaders.has(param.name.toLowerCase())) {
                    param.required = true;
                }
            }
        }
    }

    return openApiDoc;
}

async function main() {
    try {
        const collection = await fetchCollection(apiKey, collectionId);

        const requiredHeaders = extractRequiredHeaders(collection);
        if (requiredHeaders.size) {
            console.log(`Required headers: ${[...requiredHeaders].join(', ')}`);
        }

        // Fix newlines before handing to postman-to-openapi
        const cleanCollection = fixNewlines(collection);

        const tempFile = '/tmp/postman-collection.json';
        fs.writeFileSync(tempFile, JSON.stringify(cleanCollection, null, 2));

        console.log('Converting to OpenAPI...');
        const result = await postmanToOpenApi(tempFile, null, {
            defaultTag: 'General'
        });

        const config = loadConfig(outputDir);
        const collectionVars = extractCollectionVariables(collection);
        if (Object.keys(collectionVars).length) {
            console.log(`Will substitute: ${Object.keys(collectionVars).join(', ')}`);
        }

        let openApiDoc = fixNewlines(yaml.load(result));
        openApiDoc = applyRequiredHeaders(openApiDoc, requiredHeaders);
        openApiDoc = applyOpenApiVars(openApiDoc, collection.variable);

        if (config.servers) {
            openApiDoc.servers = config.servers;
        }

        // Collection variables first, config.replace overrides them
        const replacements = { ...collectionVars, ...(config.replace || {}) };
        if (Object.keys(replacements).length) {
            openApiDoc = applyReplacements(openApiDoc, replacements);
        }

        if (openApiDoc.info) {
            const now = new Date();
            const pad = n => String(n).padStart(2, '0');
            openApiDoc.info['x-updated'] = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())} UTC`;
        }

        let output = outputFile.endsWith('.json')
            ? JSON.stringify(openApiDoc, null, 2)
            : yaml.dump(openApiDoc);

        fs.writeFileSync(outputFile, output);
        console.log((outputFile.endsWith('.json') ? 'Swagger JSON' : 'Swagger YAML') + ' saved -> ' + outputFile);

        const indexFile = path.join(outputDir, 'index.html');
        const swaggerFileName = path.basename(outputFile);
        const indexExists = fs.existsSync(indexFile);
        fs.writeFileSync(indexFile, `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>API Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist/swagger-ui.css" />
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css" />
    <style>
        .renderedMarkdown blockquote {
            margin: 8px 0;
            padding: 8px 12px;
            border-left: 4px solid #89bf04;
            background: rgba(137, 191, 4, 0.08);
            border-radius: 0 4px 4px 0;
            color: inherit;
        }
        .renderedMarkdown blockquote p {
            margin: 0;
        }
        .renderedMarkdown pre {
            background: #f6f8fa;
            border-radius: 6px;
            padding: 12px;
        }
        .renderedMarkdown pre code.hljs {
            background: transparent;
            padding: 0;
            font-size: 13px;
        }
    </style>
</head>
<body>
<div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist/swagger-ui-bundle.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<script>
    const specUrl = "./${swaggerFileName}";

    SwaggerUIBundle({
        url: specUrl,
        dom_id: '#swagger-ui'
    });

    fetch(specUrl)
        .then(r => r.json())
        .then(spec => {
            const updated = spec?.info?.['x-updated'];
            if (!updated) return;
            const obs = new MutationObserver(() => {
                const info = document.querySelector('.swagger-ui .info');
                if (!info || info.querySelector('.x-updated')) return;
                const el = document.createElement('p');
                el.className = 'x-updated';
                el.style.cssText = 'font-size: 14px; margin: 8px 0 0; color: #3b4151;';
                el.innerHTML = '<strong>Updated:</strong> ' + updated;
                info.appendChild(el);
            });
            obs.observe(document.getElementById('swagger-ui'), { childList: true, subtree: true });
        });

    const hlObserver = new MutationObserver(() => {
        document.querySelectorAll('.renderedMarkdown pre code:not(.hljs)').forEach(el => {
            hljs.highlightElement(el);
        });
    });
    hlObserver.observe(document.getElementById('swagger-ui'), { childList: true, subtree: true });
</script>
</body>
</html>
`);
        console.log('index.html ' + (indexExists ? 'updated' : 'created') + ' -> ' + indexFile);

    } catch (error) {
        console.error('Error:', error.message);
        process.exit(3);
    }
}

main();