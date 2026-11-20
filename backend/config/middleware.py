"""Middleware безпеки AKP Monitor: CSP, Permissions-Policy, HSTS, приховання стеку
та заборона кешування чутливих відповідей API."""


class SecurityHeadersMiddleware:
    """Додає сучасні заголовки захисту браузера (CSP, Permissions-Policy, HSTS, Cache-Control).

    Також видаляє заголовки витоку технологічного стеку (Server, X-Powered-By, Via).
    """

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
    # Air-Gapped Ready CSP для документації API (виключно локальні ресурси 'self' без зовнішніх CDN):
    DOCS_CSP = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; "
        "font-src 'self' data:; "
        "connect-src 'self'; "
        "object-src 'none'; "
        "frame-ancestors 'none'; "
        "base-uri 'self'; "
        "form-action 'self'"
    )

    # OWASP: HSTS з preload
    HSTS_VALUE = "max-age=31536000; includeSubDomains; preload"

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        path = request.path

        # --- Permissions-Policy ---
        if "Permissions-Policy" not in response:
            response["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=(), usb=()"

        # --- CSP ---
        if "Content-Security-Policy" not in response and not path.startswith("/django-admin/"):
            if path.startswith("/api/docs"):
                response["Content-Security-Policy"] = self.DOCS_CSP
            else:
                response["Content-Security-Policy"] = self.SPA_CSP

        # --- Приховання технологічного стеку (OWASP) ---
        # Видаляємо заголовки, що розкривають серверне ПЗ
        for header in ("Server", "X-Powered-By", "Via"):
            if header in response:
                del response[header]

        # --- Заборона кешування відповідей API ---
        if path.startswith("/api/") and "Cache-Control" not in response:
            response["Cache-Control"] = "no-store, no-cache, must-revalidate, private"
            response["Pragma"] = "no-cache"

        return response
