from datetime import timedelta
from pathlib import Path
import os

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / '.env')

# Local development / tests only. Long enough that JWT signing does not warn about a short key.
DEV_SECRET_KEY = 'insecure-dev-key-for-local-development-and-tests-only-0123456789abcdef'
# The signing key for sessions AND JWT tokens: anyone who learns it can forge a login.
MIN_SECRET_KEY_LENGTH = 32  # HS256 recommends a key of at least 32 bytes
SECRET_KEY = os.getenv('DJANGO_SECRET_KEY', DEV_SECRET_KEY)
DEBUG = os.getenv('DJANGO_DEBUG', 'True').lower() in ('1', 'true', 'yes')
ALLOWED_HOSTS = [h.strip() for h in os.getenv('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',') if h.strip()]
# Phone/LAN IP changes often during Expo Go — allow any host while debugging.
if DEBUG and '*' not in ALLOWED_HOSTS:
    ALLOWED_HOSTS.append('*')

CSRF_TRUSTED_ORIGINS = [
    o.strip()
    for o in os.getenv('DJANGO_CSRF_TRUSTED_ORIGINS', '').split(',')
    if o.strip()
]
# Traefik / reverse proxy terminates TLS
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
USE_X_FORWARDED_HOST = True

if not DEBUG:
    _weak_key = (
        SECRET_KEY == DEV_SECRET_KEY
        or len(SECRET_KEY) < MIN_SECRET_KEY_LENGTH
        or SECRET_KEY.lower().startswith(('insecure', 'change-me', 'changeme'))
    )
    if _weak_key:
        raise ImproperlyConfigured(
            f'DJANGO_SECRET_KEY must be a long random value (at least {MIN_SECRET_KEY_LENGTH} characters) '
            'when DJANGO_DEBUG is False. Generate one with: '
            'python -c "import secrets; print(secrets.token_urlsafe(64))"'
        )
if not DEBUG and '*' in ALLOWED_HOSTS:
    raise ImproperlyConfigured('DJANGO_ALLOWED_HOSTS must not include * when DJANGO_DEBUG is False')

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'corsheaders',
    'rest_framework',
    'rest_framework_simplejwt',
    'rest_framework_simplejwt.token_blacklist',
    'drf_spectacular',
    'django_filters',
    'accounts',
    'barcodes',
    'warehouses',
    'inventory',
    'grn',
    'withdrawals',
    'reports',
    'integrations',
    'audit',
    'counts',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'

if os.getenv('DJANGO_TEST_SQLITE', '').lower() in ('1', 'true', 'yes') or os.getenv('DJANGO_USE_SQLITE', '').lower() in ('1', 'true', 'yes'):
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
        }
    }
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': os.getenv('DB_NAME', 'warehouse_inventory'),
            'USER': os.getenv('DB_USER', 'warehouse'),
            'PASSWORD': os.getenv('DB_PASSWORD', 'warehouse_pass'),
            'HOST': os.getenv('DB_HOST', '127.0.0.1'),
            'PORT': os.getenv('DB_PORT', '5432'),
        }
    }

# Shared by all gunicorn workers (unlike in-memory caches), so rate limits and login lockouts
# really apply. Created by `manage.py createcachetable` (run on container start).
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.db.DatabaseCache',
        'LOCATION': 'django_cache',
    }
}

AUTH_USER_MODEL = 'accounts.User'

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STORAGES = {
    'default': {
        'BACKEND': 'django.core.files.storage.FileSystemStorage',
    },
    'staticfiles': {
        'BACKEND': 'whitenoise.storage.CompressedManifestStaticFilesStorage',
    },
}
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

CORS_ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv(
        'DJANGO_CORS_ALLOWED_ORIGINS',
        'http://localhost:8081,http://127.0.0.1:8081',
    ).split(',')
    if o.strip()
]
CORS_ALLOW_CREDENTIALS = True

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticated',
    ),
    'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema',
    'DEFAULT_FILTER_BACKENDS': (
        'django_filters.rest_framework.DjangoFilterBackend',
        'rest_framework.filters.SearchFilter',
        'rest_framework.filters.OrderingFilter',
    ),
    'DEFAULT_THROTTLE_CLASSES': (
        'rest_framework.throttling.AnonRateThrottle',
        'rest_framework.throttling.UserRateThrottle',
    ),
    'DEFAULT_THROTTLE_RATES': {
        'anon': '30/min',
        'user': '300/min',
    },
    # Reverse proxies in front of gunicorn (Traefik = 1; add 1 more if Cloudflare is also in front).
    # Used to find the real client address for throttling and login lockout; 0 trusts only the socket.
    'NUM_PROXIES': int(os.getenv('DJANGO_NUM_PROXIES', '0' if DEBUG else '1')),
    'EXCEPTION_HANDLER': 'config.exceptions.custom_exception_handler',
}

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(
        minutes=int(os.getenv('ACCESS_TOKEN_LIFETIME_MINUTES', '60'))
    ),
    'REFRESH_TOKEN_LIFETIME': timedelta(
        days=int(os.getenv('REFRESH_TOKEN_LIFETIME_DAYS', '7'))
    ),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
    'UPDATE_LAST_LOGIN': True,
}

SPECTACULAR_SETTINGS = {
    'TITLE': 'Warehouse Inventory API',
    'DESCRIPTION': 'Warehouse Inventory Management System API',
    'VERSION': '1.0.0',
}

COMPANY_NAME = os.getenv('COMPANY_NAME', 'Airport Equipment Manufacturing')
