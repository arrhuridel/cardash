#!/usr/bin/env python3
"""
Fabrique le "jeton developpeur" Apple Music (JWT) a partir de ta cle privee .p8.

CE QU'IL TE FAUT (compte Apple Developer payant) :
  1. Va sur developer.apple.com, "Certificates, Identifiers & Profiles".
  2. Dans "Identifiers", cree un "Media ID" (Media Services, Apple Music).
  3. Dans "Keys", cree une cle, coche "Media Services (MusicKit...)", telecharge le fichier AuthKey_XXXXXXXXXX.p8.
     Apple ne te le donne qu'UNE fois : garde-le prive, ne l'envoie a personne.
  4. Note ton Team ID (en haut a droite de ton compte) et le Key ID de la cle (10 caracteres).

UTILISATION :
  python apple_music_token.py --team TON_TEAM_ID --key-id TON_KEY_ID --p8 chemin\\AuthKey_XXXX.p8

Le jeton s'affiche : copie-le dans CarDash, Reglages, "Jeton Apple Music".
Il est valable 150 jours par defaut (Apple accepte 6 mois au maximum). Refais-le ensuite.

Ce script n'installe rien : il utilise "openssl" (fourni avec Git pour Windows) et Python.
La cle .p8 ne quitte jamais ton ordinateur.
"""
import argparse
import base64
import json
import subprocess
import sys
import time


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def der_to_raw(der: bytes) -> bytes:
    """Signature ECDSA au format DER (openssl) -> format brut r||s de 64 octets (JWT ES256)."""
    if der[0] != 0x30:
        raise ValueError("signature inattendue")
    i = 2
    if der[1] & 0x80:                       # longueur sur plusieurs octets
        i = 2 + (der[1] & 0x7F)
    parts = []
    for _ in range(2):
        if der[i] != 0x02:
            raise ValueError("signature inattendue")
        n = der[i + 1]
        parts.append(der[i + 2:i + 2 + n].lstrip(b"\x00").rjust(32, b"\x00"))
        i += 2 + n
    return parts[0] + parts[1]


def make_token(team_id: str, key_id: str, p8_path: str, days: int) -> str:
    now = int(time.time())
    header = {"alg": "ES256", "kid": key_id}
    payload = {"iss": team_id, "iat": now, "exp": now + days * 86400}
    signing_input = b64u(json.dumps(header, separators=(",", ":")).encode()) + "." + \
        b64u(json.dumps(payload, separators=(",", ":")).encode())
    try:
        res = subprocess.run(["openssl", "dgst", "-sha256", "-sign", p8_path],
                             input=signing_input.encode(), capture_output=True, check=True)
    except FileNotFoundError:
        sys.exit("openssl est introuvable. Ouvre ce script depuis 'Git Bash' (il fournit openssl).")
    except subprocess.CalledProcessError as e:
        sys.exit("Signature impossible : " + e.stderr.decode(errors="replace").strip())
    return signing_input + "." + b64u(der_to_raw(res.stdout))


def main():
    ap = argparse.ArgumentParser(description="Fabrique un jeton developpeur Apple Music")
    ap.add_argument("--team", required=True, help="Team ID Apple (10 caracteres)")
    ap.add_argument("--key-id", required=True, help="Key ID de la cle MusicKit (10 caracteres)")
    ap.add_argument("--p8", required=True, help="chemin du fichier AuthKey_XXXX.p8")
    ap.add_argument("--days", type=int, default=150, help="duree de validite (max 180)")
    args = ap.parse_args()
    if not 1 <= args.days <= 180:
        sys.exit("--days doit etre entre 1 et 180 (Apple limite a 6 mois)")
    print(make_token(args.team, args.key_id, args.p8, args.days))


if __name__ == "__main__":
    main()
