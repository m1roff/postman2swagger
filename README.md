# postman2swagger

Docker-образ для генерации Swagger/OpenAPI документации из Postman-коллекции.

Скачивает коллекцию из Postman API и конвертирует в `swagger.json` или `swagger.yaml`.

## Использование

```bash
docker run --rm \
    -v /path/to/output:/docs \
    miroff/postman2swagger:latest \
    "<POSTMAN_API_KEY>" \
    "<POSTMAN_COLLECTION_ID>" \
    "/docs/swagger.json"
```

Выходной формат определяется расширением файла: `.json` или `.yaml`/`.yml`.

## Внедрение в проект

### 1. Добавить переменные окружения

В `.env` (или CI/CD secrets):

```
POSTMAN_API_KEY=your-postman-api-key
POSTMAN_API_EXTERNAL_COLLECTION_ID=your-collection-id
```

**POSTMAN_API_KEY** — Postman → аватарка (правый верхний угол) → Settings → API keys → Generate API Key.

**POSTMAN_API_EXTERNAL_COLLECTION_ID** — открыть коллекцию в [Postman Web](https://app.getpostman.com), в URL будет:
```
https://app.getpostman.com/collection/12345678-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```
Длинный UUID после последнего слэша — это и есть Collection ID.  
Альтернативно: правый клик на коллекции → View documentation → ID в URL страницы.

### 2. Добавить цель в Makefile проекта

```makefile
doc-swagger: ## Generate Swagger documentation
    docker run --rm \
        -v $(shell pwd)/docs/swagger:/docs \
        miroff/postman2swagger:latest \
        "$(POSTMAN_API_KEY)" \
        "$(POSTMAN_API_EXTERNAL_COLLECTION_ID)" \
        "/docs/swagger.json"
```

### 3. Создать конфиг (опционально)

Положи `swagger.config.yaml` рядом с `swagger.json` (в той же папке, которая монтируется как `/docs`):

```yaml
servers:
  - url: https://api.yourproject.com
    description: Production

replace:
  "{{host}}": api.yourproject.com
  "{{alert.intake.key}}": your-key-here
  "{{alert.intake.header.timestamp}}": "1234567890"
```

- **`servers`** — полностью перезаписывает список серверов из коллекции
- **`replace`** — глобальные замены строк по всему документу (пути, описания, примеры)

Конфиг подхватывается автоматически — менять команду в Makefile не нужно.

### 4. Добавить директорию в .gitignore (опционально)

Если генерируемый файл не нужно коммитить:

```
docs/swagger/swagger.json
```

## Обновление образа

Образ версионируется тегами. Рекомендуется указывать конкретную версию вместо `latest`:

```makefile
miroff/postman2swagger:1.0.0
```

## Разработка

```bash
# Собрать образ локально
make build IMAGE=my-org/postman2swagger TAG=dev

# Опубликовать
make push IMAGE=my-org/postman2swagger TAG=1.0.0
```