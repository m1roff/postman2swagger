IMAGE ?= miroff/postman2swagger
TAG ?= latest

all: help

help: ## Show this help
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

build: ## Build Docker image for current platform
	docker build -t $(IMAGE):$(TAG) .

push: ## Push image to Docker Hub
	docker push $(IMAGE):$(TAG)

release: build push ## Build and push for current platform

build-multiplatform: ## Build and push for linux/amd64 and linux/arm64
	docker buildx inspect multiplatform-builder > /dev/null 2>&1 || docker buildx create --name multiplatform-builder --driver docker-container --use
	docker buildx use multiplatform-builder
	docker buildx build --platform linux/amd64,linux/arm64 -t $(IMAGE):$(TAG) --push .

.PHONY: build push release build-multiplatform