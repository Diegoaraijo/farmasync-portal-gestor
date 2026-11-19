"""Gera os ícones do portal (atalho no celular) com o "+" azul do FarmaSync.

Uso: python tools/gerar_icones.py   (a partir da pasta portal_gestor)
O "+" é desenhado em vetor (supersampling) para ficar nítido em qualquer tamanho.
"""

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

PUBLIC = Path(__file__).resolve().parent.parent / "public"
SS = 4  # supersampling
COR_CLARA = (33, 170, 247)   # canto superior direito do "+" original
COR_ESCURA = (26, 120, 238)  # canto inferior esquerdo


def cruz(lado: int, braco: float = 0.375, raio: float = 0.14) -> Image.Image:
    """Cruz com pontas arredondadas e degradê diagonal, ocupando `lado` px, fundo transparente."""

    g = lado * SS
    mascara = Image.new("L", (g, g), 0)
    d = ImageDraw.Draw(mascara)
    a = g * braco
    c0, c1 = (g - a) / 2, (g + a) / 2
    r = g * raio
    d.rounded_rectangle((c0, 0, c1, g), radius=r, fill=255)
    d.rounded_rectangle((0, c0, g, c1), radius=r, fill=255)
    gradiente = Image.new("RGB", (g, g))
    px = gradiente.load()
    for y in range(g):
        for x in range(g):
            t = ((g - x) + y) / (2 * g)  # 0 = canto sup. direito, 1 = inf. esquerdo
            px[x, y] = tuple(round(COR_CLARA[i] + (COR_ESCURA[i] - COR_CLARA[i]) * t) for i in range(3))
    cheia = gradiente.convert("RGBA")
    cheia.putalpha(mascara)
    return cheia.resize((lado, lado), Image.LANCZOS)


def icone_transparente(lado: int, proporcao: float = 0.92) -> Image.Image:
    """Só o "+" com fundo transparente (ícones 'any' do Android)."""

    tamanho = round(lado * proporcao)
    base = Image.new("RGBA", (lado, lado), (0, 0, 0, 0))
    base.alpha_composite(cruz(tamanho), ((lado - tamanho) // 2, (lado - tamanho) // 2))
    return base


def icone_ios(lado: int, proporcao: float = 0.60) -> Image.Image:
    """O iOS não aceita transparência (vira preto): usa o azul escuro do sistema como fundo."""

    topo, base_cor = (22, 64, 112), (12, 38, 74)
    img = Image.new("RGB", (lado, lado))
    px = img.load()
    for y in range(lado):
        t = y / (lado - 1)
        cor = tuple(round(topo[i] + (base_cor[i] - topo[i]) * t) for i in range(3))
        for x in range(lado):
            px[x, y] = cor
    tamanho = round(lado * proporcao)
    rgba = img.convert("RGBA")
    rgba.alpha_composite(cruz(tamanho), ((lado - tamanho) // 2, (lado - tamanho) // 2))
    return rgba.convert("RGB")


def main() -> None:
    icone_ios(180).save(PUBLIC / "apple-touch-icon.png", optimize=True)
    print("gerado: apple-touch-icon.png (fundo azul escuro, exigido pelo iOS)")
    for nome, lado in (("icon-192.png", 192), ("icon-512.png", 512)):
        icone_transparente(lado).save(PUBLIC / nome, optimize=True)
        print("gerado:", nome, "(transparente)")
    cruz(64).save(PUBLIC / "favicon.png", optimize=True)
    print("gerado: favicon.png")


if __name__ == "__main__":
    main()
