.PHONY: help install dev prod test clean setup-dev build logs health

help:
	@echo "Retro Games1 Server - Available Commands:"
	@echo "  install     - Install all dependencies"
	@echo "  dev         - Start development environment"
	@echo "  prod        - Start production environment"
	@echo "  test        - Run all tests"
	@echo "  build       - Build all components"
	@echo "  clean       - Clean up containers and volumes"

install:
	@echo "Installing dependencies..."
	cd backend && npm install
	cd frontend && npm install

dev:
	@echo "Starting development environment..."
	docker-compose up --build

prod:
	@echo "Starting production environment..."
	docker-compose up -d --build

test:
	@echo "Running tests..."
	cd backend && npm test

build:
	@echo "Building all services..."
	docker-compose build

clean:
	@echo "Cleaning up..."
	docker-compose down -v
	docker system prune -f

logs:
	docker-compose logs -f

health:
	@echo "Checking service health..."
	curl -f http://localhost/api/health || echo "Backend not healthy"
