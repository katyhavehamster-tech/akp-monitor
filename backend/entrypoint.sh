#!/bin/sh
set -e
python manage.py migrate --noinput
python manage.py import_dataset   # нічого не робить, якщо дані вже є
python manage.py collectstatic --noinput -v0
exec gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 3
