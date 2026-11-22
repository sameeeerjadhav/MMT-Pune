"""Signed media URLs so /media/ is not anonymously browsable without a token."""

from urllib.parse import urlencode

from django.conf import settings
from django.core.signing import BadSignature, SignatureExpired, TimestampSigner
from django.http import Http404
from django.views.static import serve

# Long enough for offline list caching; short enough to limit URL sharing.
MEDIA_URL_MAX_AGE = 60 * 60 * 24 * 7  # 7 days
_signer = TimestampSigner(salt='inventory.media')


def sign_media_name(name: str) -> str:
    return _signer.sign(name)


def absolute_media_url(request, file_field):
    if not file_field:
        return None
    name = file_field.name
    base = file_field.url
    if request is not None:
        base = request.build_absolute_uri(base)
    sep = '&' if '?' in base else '?'
    return f'{base}{sep}{urlencode({"sig": sign_media_name(name)})}'


def serve_signed_media(request, path):
    sig = request.GET.get('sig')
    if not sig:
        raise Http404('Missing media signature')
    try:
        unsigned = _signer.unsign(sig, max_age=MEDIA_URL_MAX_AGE)
    except SignatureExpired as exc:
        raise Http404('Expired media signature') from exc
    except BadSignature as exc:
        raise Http404('Invalid media signature') from exc
    if unsigned != path:
        raise Http404('Media signature mismatch')
    return serve(request, path, document_root=settings.MEDIA_ROOT)
