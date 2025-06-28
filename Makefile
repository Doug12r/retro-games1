.PHONY: help install dev prod test clean setup-dev build logs health backup

# Default target
help:
	@echo "Retro Games1 Server - Available Commands:"
	@echo "  install     - Install all dependencies"
	@echo "  dev         - Start development environment"
	@echo "  prod        - Start production environment"
	@echo "  test        - Run all tests"
	@echo "  build       - Build all components"
	@echo "  clean       - Clean up containers and volumes"
	@echo "  setup-dev   - Set up development environment"
	@echo "  logs        - View service logs"
	@echo "  health      - Check service health"
	@echo "  backup      - Create backup"

install:
	@echo "Installing dependencies..."
	cd backend && npm install
	cd frontend && npm install

setup-dev:
	@echo "Setting up development environment..."
	cp .env.example .env
	@echo "Please edit .env file with your configuration"
	docker-compose pull

dev:
	@echo "Starting development environment..."
	docker-compose -f docker-compose.yml up --build

prod:
	@echo "Starting production environment..."
	docker-compose up -d --build

test:
	@echo "Running tests..."
	cd backend && npm test
	cd frontend && npm test

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
	curl -f http://localhost/ || echo "Frontend not healthy"

backup:
	@echo "Creating backup..."
	./scripts/backup.sh

restore:
	@echo "Restoring from backup..."
	./scripts/restore.sh
