#!/usr/bin/env python3
"""Refresh Racing Post access token via AWS Cognito.

Cognito access tokens duram 30 min — não cabe no cron diário sem renovação.
Esse script faz login com email+senha (USER_PASSWORD_AUTH) e atualiza o
ACCESS_TOKEN no .env do rpscrape.

Uso:
  python refresh_token.py [--rpscrape-env /path/to/rpscrape/.env]

Variáveis esperadas em /home/mazedev/rpscrape/.env (ou path passado):
  EMAIL=horsingmaze10@outlook.com
  RP_PASSWORD=<senha>      # gravada após este script atualizar
  ACCESS_TOKEN=<atualizado automaticamente>

Se USER_PASSWORD_AUTH não estiver habilitado no pool, fallback é AWS SRP
(implementação manual — adicionar depois se preciso).
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from dotenv import dotenv_values

# Constantes derivadas do source do rpscrape (utils/network.py) e do JWT decoded
COGNITO_REGION = "eu-west-1"
COGNITO_CLIENT_ID = "3fii107m4bmtggnm21pud2es21"

DEFAULT_RPSCRAPE_ENV = "/home/mazedev/rpscrape/.env"


def refresh_access_token(email: str, password: str) -> str:
    """Faz USER_PASSWORD_AUTH e retorna o AccessToken novo."""
    client = boto3.client(
        "cognito-idp",
        region_name=COGNITO_REGION,
        # Endpoints públicos, sem credenciais AWS
        config=Config(signature_version="UNSIGNED"),
    )
    try:
        resp = client.initiate_auth(
            AuthFlow="USER_PASSWORD_AUTH",
            AuthParameters={
                "USERNAME": email,
                "PASSWORD": password,
            },
            ClientId=COGNITO_CLIENT_ID,
        )
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code")
        if code == "NotAuthorizedException":
            print(f"FAIL: NotAuthorizedException — senha errada ou USER_PASSWORD_AUTH desativado no pool", file=sys.stderr)
        else:
            print(f"FAIL: {code}: {e}", file=sys.stderr)
        raise

    auth = resp.get("AuthenticationResult", {})
    access_token = auth.get("AccessToken")
    if not access_token:
        raise RuntimeError(f"AuthenticationResult missing AccessToken: {resp}")
    # Cognito também retorna RefreshToken — guardar pode habilitar renovação sem senha
    return access_token


def update_env_file(env_path: Path, new_token: str) -> None:
    """Lê o .env atual, atualiza ACCESS_TOKEN, reescreve mantendo outras vars."""
    if not env_path.exists():
        raise FileNotFoundError(env_path)

    lines = env_path.read_text().splitlines(keepends=False)
    found = False
    new_lines: list[str] = []
    for line in lines:
        if line.startswith("ACCESS_TOKEN="):
            new_lines.append(f"ACCESS_TOKEN={new_token}")
            found = True
        else:
            new_lines.append(line)
    if not found:
        new_lines.append(f"ACCESS_TOKEN={new_token}")

    # Atomic write (tmp → rename)
    tmp = env_path.with_suffix(env_path.suffix + ".tmp")
    tmp.write_text("\n".join(new_lines) + "\n")
    tmp.chmod(0o600)
    tmp.replace(env_path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rpscrape-env", default=DEFAULT_RPSCRAPE_ENV)
    args = ap.parse_args()

    env_path = Path(args.rpscrape_env).expanduser()
    creds = dotenv_values(env_path)
    email = creds.get("EMAIL")
    password = creds.get("RP_PASSWORD")
    if not email or not password:
        print(f"FAIL: EMAIL ou RP_PASSWORD ausente em {env_path}", file=sys.stderr)
        sys.exit(1)

    print(f"📥 refresh token: email={email}", file=sys.stderr)
    new_token = refresh_access_token(email, password)
    update_env_file(env_path, new_token)
    print(f"✅ token renovado em {env_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
