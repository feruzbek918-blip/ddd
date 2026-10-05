def salom(ism: str) -> str:
    return f"Salom, {ism}!"


if __name__ == "__main__":
    ism = input("Ismingiz nima? ").strip() or "do'st"
    print(salom(ism))
