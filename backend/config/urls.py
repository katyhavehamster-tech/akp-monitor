import mimetypes

from django.conf import settings
from django.contrib import admin
from django.http import FileResponse, HttpResponse
from django.urls import include, path, re_path
from django.views.decorators.csrf import ensure_csrf_cookie
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

STATIC_EXTS = {
    ".png", ".svg", ".ico", ".jpg", ".jpeg", ".webp", ".gif",
    ".js", ".mjs", ".css", ".map", ".woff", ".woff2", ".ttf", ".json", ".txt", ".webmanifest",
}


@ensure_csrf_cookie
def spa(request, *args, **kwargs):
    """Віддає статичні файли з frontend/dist або index.html для маршрутів SPA."""
    dist = settings.FRONTEND_DIST
    rel = request.path.lstrip("/")
    if rel and dist.exists():
        try:
            dist_root = dist.resolve()
            candidate = (dist_root / rel).resolve()
            if candidate.is_relative_to(dist_root) and candidate.is_file():
                ctype, _ = mimetypes.guess_type(str(candidate))
                resp = FileResponse(candidate.open("rb"), content_type=ctype or "application/octet-stream")
                if rel.startswith("assets/"):
                    resp["Cache-Control"] = "public, max-age=31536000, immutable"
                else:
                    resp["Cache-Control"] = "public, max-age=3600"
                return resp
        except OSError:
            pass

    dot_idx = rel.rfind(".")
    if dot_idx != -1 and rel[dot_idx:].lower() in STATIC_EXTS:
        return HttpResponse("Файл не знайдено.", status=404, content_type="text/plain; charset=utf-8")

    index = dist / "index.html"
    if index.exists():
        resp = HttpResponse(index.read_text(encoding="utf-8"), content_type="text/html; charset=utf-8")
        resp["Cache-Control"] = "no-cache"
        return resp
    return HttpResponse("Фронтенд не зібрано: cd frontend && npm install && npm run build", status=503)


urlpatterns = [
    path("django-admin/", admin.site.urls),
    path("api/", include("monitor.urls")),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema")),
    path("media/<path:path>", lambda request, path: HttpResponse(
        "Доступ до файлів підтверджень здійснюється виключно через авторизоване API.",
        status=403, content_type="text/plain; charset=utf-8",
    )),
    re_path(r"^(?!api/|django-admin/|static/|media/).*$", spa),
]
