"""Криптографічний модуль обробки та перевірки файлових ключів доступу (AKP-KEY-V1).

Формат ключа:
- Алгоритм підпису: ECDSA P-256 (SECP256R1)
- Шифрування контейнера: PBKDF2 (SHA-256, 100 000 ітерацій) + AES-256-GCM
- Приватні ключі зберігаються виключно локально у власника
- На сервері зберігається лише SubjectPublicKeyInfo (PEM) та SHA-256 відбиток
"""

import base64
import hashlib
import os
from datetime import datetime, timedelta, timezone

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature, encode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC


def calculate_public_key_fingerprint(public_key_pem: str) -> str:
    """Обчислює SHA-256 відбиток публічного ключа з DER SubjectPublicKeyInfo."""
    pub = serialization.load_pem_public_key(public_key_pem.encode("utf-8"))
    spki_der = pub.public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return hashlib.sha256(spki_der).hexdigest()


def generate_key_file(user_login: str, role: str, password: str, iterations: int = 100000, expires_in_days: int = 365) -> dict:
    """Генерує пару ключів ECDSA P-256 та формує зашифрований контейнер AKP-KEY-V1."""
    priv = ec.generate_private_key(ec.SECP256R1())
    pub = priv.public_key()

    pub_pem = pub.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("utf-8")

    pub_der = pub.public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    fingerprint = hashlib.sha256(pub_der).hexdigest()

    pkcs8_der = priv.private_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )

    salt = os.urandom(16)
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=iterations,
    )
    key = kdf.derive(password.encode("utf-8"))

    iv = os.urandom(12)
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(iv, pkcs8_der, None)

    now_dt = datetime.now(timezone.utc)
    exp_dt = now_dt + timedelta(days=expires_in_days)

    return {
        "format": "AKP-KEY-V1",
        "user_login": user_login,
        "role": role,
        "fingerprint": fingerprint,
        "created_at": now_dt.isoformat(),
        "expires_at": exp_dt.isoformat(),
        "crypto": {
            "kdf": "PBKDF2",
            "hash": "SHA-256",
            "iterations": iterations,
            "salt": base64.b64encode(salt).decode("ascii"),
            "cipher": "AES-256-GCM",
            "iv": base64.b64encode(iv).decode("ascii"),
            "ciphertext": base64.b64encode(ciphertext).decode("ascii"),
            "public_key": pub_pem,
        },
    }


def verify_key_signature(public_key_pem: str, challenge_bytes: bytes, signature_bytes: bytes) -> bool:
    """Перевіряє цифровий підпис виклику (challenge) за допомогою публічного ключа.

    Підтримує як формат IEEE P1363 (64 байти з Web Crypto API), так і DER.
    """
    try:
        pub = serialization.load_pem_public_key(public_key_pem.encode("utf-8"))
        if not isinstance(pub, ec.EllipticCurvePublicKey):
            return False

        if len(signature_bytes) == 64:
            r = int.from_bytes(signature_bytes[:32], "big")
            s = int.from_bytes(signature_bytes[32:], "big")
            der_sig = encode_dss_signature(r, s)
        else:
            der_sig = signature_bytes

        pub.verify(der_sig, challenge_bytes, ec.ECDSA(hashes.SHA256()))
        return True
    except (InvalidSignature, ValueError, TypeError):
        return False


def decrypt_private_key_der(key_file_container: dict, password: str) -> bytes:
    """Розшифровує PKCS#8 DER приватний ключ із контейнера AKP-KEY-V1 за паролем."""
    c = key_file_container.get("crypto", {})
    salt = base64.b64decode(c["salt"])
    iv = base64.b64decode(c["iv"])
    ciphertext = base64.b64decode(c["ciphertext"])
    iterations = c.get("iterations", 100000)

    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=iterations,
    )
    key = kdf.derive(password.encode("utf-8"))
    aesgcm = AESGCM(key)
    return aesgcm.decrypt(iv, ciphertext, None)


def sign_challenge_with_key_container(key_file_container: dict, password: str, challenge_b64: str) -> str:
    """Розшифровує ключ і підписує challenge у форматі IEEE P1363 (base64)."""
    pkcs8_der = decrypt_private_key_der(key_file_container, password)
    priv = serialization.load_der_private_key(pkcs8_der, password=None)
    challenge_bytes = base64.b64decode(challenge_b64)
    der_sig = priv.sign(challenge_bytes, ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der_sig)
    p1363 = r.to_bytes(32, "big") + s.to_bytes(32, "big")
    return base64.b64encode(p1363).decode("ascii")


_TEST_KEY_CONTAINERS = {}


def get_or_create_test_key_container(login: str, role: str = "ADMIN", password: str = "demo") -> dict:
    """Кешований генератор тестових контейнерів ключів (для тестів та локального оточення)."""
    clean_login = login.strip().lower()
    if clean_login not in _TEST_KEY_CONTAINERS:
        _TEST_KEY_CONTAINERS[clean_login] = generate_key_file(clean_login, role, password)
    return _TEST_KEY_CONTAINERS[clean_login]


