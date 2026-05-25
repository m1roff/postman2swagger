IMAGE ?= miroff/postman2swagger
TAG ?= latest

build: ## Build Docker image
	docker build -t $(IMAGE):$(TAG) .

push: ## Push image to Docker Hub
	docker push $(IMAGE):$(TAG)

release: build push ## Build and push
build-and-push: build push ## Build and push (alias for release)

.PHONY: build push release build-and-push