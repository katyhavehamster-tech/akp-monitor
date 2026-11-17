from django.conf import settings
from django.contrib import admin
from django.http import HttpResponse
from django.urls import include, path, re_path
from django.views.static import serve
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView


def spa(request, *args, **kwargs):
    """Віддає зібраний React-застосунок (frontend/dist/index.html) для всіх маршрутів SPA."""
    index = settings.FRONTEND_DIST / "index.html"
    if index.exists():
        return HttpResponse(index.read_text(encoding="utf-8"))
    return HttpResponse("Фронтенд не зібрано: cd frontend && npm install && npm run build", status=503)


urlpatterns = [
    path("django-admin/", admin.site.urls),
    path("api/", include("monitor.urls")),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema")),
    re_path(r"^media/(?P<path>.*)$", serve, {"document_root": settings.MEDIA_ROOT}),
    re_path(r"^(?!api/|django-admin/|static/|media/).*$", spa),
]
