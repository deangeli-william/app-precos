# Desenha os ícones do app (fundo verde, código de barras e "R$") só com Python puro.
# Roda na publicação: python3 icones/gerar.py <pasta-de-saída>
import struct
import sys
import zlib

VERDE = (0x1F, 0x6F, 0x5C)
BRANCO = (255, 255, 255)
LETRAS = {
    'R': ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
    '$': ['00100', '01111', '10100', '01110', '00101', '11110', '00100'],
}


def desenhar(caminho, s):
    px = [[VERDE] * s for _ in range(s)]

    def ret(x0, y0, x1, y1):
        for y in range(max(0, round(y0)), min(s, round(y1))):
            linha = px[y]
            for x in range(max(0, round(x0)), min(s, round(x1))):
                linha[x] = BRANCO

    # barras
    larguras = [3, 2, 2, 1, 4, 2, 1, 1, 3, 2, 2, 1, 3]
    u = s * 0.56 / sum(larguras)
    x = s * 0.22
    for i, w in enumerate(larguras):
        if i % 2 == 0:
            ret(x, s * 0.18, x + w * u, s * 0.54)
        x += w * u

    # "R$" em letras de pixels
    c = s * 0.024
    tx = (s - 11 * c) / 2
    ty = s * 0.62
    for gi, ch in enumerate('R$'):
        for r, linha in enumerate(LETRAS[ch]):
            for k, b in enumerate(linha):
                if b == '1':
                    col = gi * 6 + k
                    ret(tx + col * c, ty + r * c, tx + (col + 1) * c, ty + (r + 1) * c)

    bruto = b''.join(b'\x00' + bytes(v for p in linha for v in p) for linha in px)

    def bloco(tipo, dados):
        return struct.pack('>I', len(dados)) + tipo + dados + struct.pack('>I', zlib.crc32(tipo + dados) & 0xFFFFFFFF)

    png = (b'\x89PNG\r\n\x1a\n'
           + bloco(b'IHDR', struct.pack('>IIBBBBB', s, s, 8, 2, 0, 0, 0))
           + bloco(b'IDAT', zlib.compress(bruto, 9))
           + bloco(b'IEND', b''))
    with open(caminho, 'wb') as f:
        f.write(png)


if __name__ == '__main__':
    saida = sys.argv[1] if len(sys.argv) > 1 else '.'
    for tamanho in (180, 192, 512):
        desenhar(f'{saida}/icone-{tamanho}.png', tamanho)
