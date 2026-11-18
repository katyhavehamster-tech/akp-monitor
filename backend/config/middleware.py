"""Middleware безпеки AKP Monitor: CSP, Permissions-Policy та заборона кешування чутливих відповідей API."""


class SecurityHeadersMiddleware:
    """Додає сучасні заголовки захисту браузера (CSP, Permissions-Policy, Cache-Control для API)."""

    SPA_CSP = (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; "
        "font-src 'self' data:; "
        "connect-src 'self'; "
        "object-src 'none'; "
        "frame-ancestors 'none'; "
        "base-uri 'self'; "
        "form-action 'self'"
    )
    DOCS_CSP = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
        "img-src 'self' data: https://cdn.jsdelivr.net; "
        "font-src 'self' data: https://cdn.jsdelivr.net; "
        "frame-ancestors 'none'; "
        "base-uri 'self'"
    )

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        path = request.path

        if "Permissions-Policy" not in response:
            response["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=(), usb=()"

        if "Content-Security-Policy" not in response and not path.startswith("/django-admin/"):
            if path.startswith("/api/docs"):
                response["Content-Security-Policy"] = self.DOCS_CSP
            else:
                response["Content-Security-Policy"] = self.SPA_CSP

        if path.startswith("/api/") and "Cache-Control" not in response:
            response["Cache-Control"] = "no-store, no-cache, must-revalidate, private"
            response["Pragma"] = "no-cache"

        return response
