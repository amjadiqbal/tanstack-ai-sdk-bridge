"""Generate SVG art for @amjadiqbal/tanstack-ai-sdk-bridge (TanStack-channel family, violet accent)."""
import os
import sys

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif"
MONO = "Menlo, 'SF Mono', Consolas, monospace"
NAME = "@amjadiqbal/tanstack-ai-sdk-bridge"
REPO = "github.com/amjadiqbal/tanstack-ai-sdk-bridge"

DARK = dict(bg1="#0B1220", bg2="#111C33", text="#F8FAFC", accent="#A78BFA", sub="#C4B5FD",
            muted="#94A3B8", chip="#16213A", chipstroke="#24324F", chiptext="#CBD5E1",
            foot="#64748B", panel="#0F172A", panelstroke="#2E3B5C", kw="#F0ABFC", fn="#7DD3FC",
            str="#86EFAC", plain="#E2E8F0", dim="#64748B")
LIGHT = dict(bg1="#F8FAFC", bg2="#ECE9FB", text="#0F172A", accent="#7C3AED", sub="#6D28D9",
             muted="#475569", chip="#FFFFFF", chipstroke="#CBD5E1", chiptext="#334155",
             foot="#64748B", panel="#0F172A", panelstroke="#C4B5FD", kw="#F0ABFC", fn="#7DD3FC",
             str="#86EFAC", plain="#E2E8F0", dim="#64748B")


def icon_body():
    """512x512 icon: many provider plugs on the left, one bridge arch, one event stream out on the right."""
    return """
  <defs>
    <linearGradient id="ibg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0F172A"/><stop offset="1" stop-color="#1A1840"/>
    </linearGradient>
    <linearGradient id="arch" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#C4B5FD"/><stop offset="1" stop-color="#8B5CF6"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#ibg)"/>
  <!-- provider plugs (left) -->
  <g>
    <rect x="52" y="132" width="92" height="44" rx="22" fill="#1E293B" stroke="#7DD3FC" stroke-width="5"/>
    <rect x="52" y="214" width="92" height="44" rx="22" fill="#1E293B" stroke="#86EFAC" stroke-width="5"/>
    <rect x="52" y="296" width="92" height="44" rx="22" fill="#1E293B" stroke="#F0ABFC" stroke-width="5"/>
    <circle cx="80" cy="154" r="8" fill="#7DD3FC"/><rect x="96" y="148" width="32" height="12" rx="6" fill="#475569"/>
    <circle cx="80" cy="236" r="8" fill="#86EFAC"/><rect x="96" y="230" width="32" height="12" rx="6" fill="#475569"/>
    <circle cx="80" cy="318" r="8" fill="#F0ABFC"/><rect x="96" y="312" width="32" height="12" rx="6" fill="#475569"/>
  </g>
  <!-- wires converge on the bridge -->
  <g stroke="#475569" stroke-width="6" fill="none" stroke-linecap="round">
    <path d="M144 154 C 180 154, 182 230, 206 236"/>
    <path d="M144 236 H 206"/>
    <path d="M144 318 C 180 318, 182 242, 206 236"/>
  </g>
  <!-- bridge: deck + arch + hangers -->
  <path d="M196 300 Q 296 120 396 300" fill="none" stroke="url(#arch)" stroke-width="18" stroke-linecap="round"/>
  <g stroke="#A78BFA" stroke-width="6" stroke-linecap="round">
    <path d="M246 232 V 300"/><path d="M296 212 V 300"/><path d="M346 232 V 300"/>
  </g>
  <rect x="180" y="296" width="232" height="20" rx="10" fill="#A78BFA"/>
  <circle cx="206" cy="236" r="14" fill="#0F172A" stroke="#C4B5FD" stroke-width="6"/>
  <!-- one event stream out (right) -->
  <g fill="#C4B5FD">
    <rect x="300" y="352" width="128" height="18" rx="9"/>
    <rect x="300" y="384" width="96" height="18" rx="9" fill="#A78BFA"/>
    <rect x="300" y="416" width="60" height="18" rx="9" fill="#8B5CF6"/>
  </g>
  <path d="M432 378 l22 15 l-22 15 z" fill="#F8FAFC"/>
"""


def icon_svg():
    return f'<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">{icon_body()}</svg>\n'


def chips(x, y, labels, c, size=15, h=32, gap=10, cw=8.6):
    out, cx = [], x
    for lab in labels:
        w = round(len(lab) * cw + 36)
        out.append(f'<g transform="translate({cx},{y})"><rect width="{w}" height="{h}" rx="{h/2}" fill="{c["chip"]}" stroke="{c["chipstroke"]}"/>'
                   f'<text x="{w/2}" y="{h*0.66:.1f}" text-anchor="middle">{lab}</text></g>')
        cx += w + gap
    return f'<g font-family="{SANS}" font-size="{size}" font-weight="600" fill="{c["chiptext"]}">' + "".join(out) + "</g>"


def code_card(x, y, w, c, lines, size=15, lh=24):
    """Dark code card (always dark, also on the light banner). lines = list of [(text, colour-key)]."""
    h = 28 + lh * len(lines)
    g = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="{c["panel"]}" stroke="{c["panelstroke"]}" stroke-width="2"/>',
         f'<g font-family="{MONO}" font-size="{size}">']
    for i, parts in enumerate(lines):
        spans = "".join(f'<tspan fill="{c[k]}">{t}</tspan>' for t, k in parts)
        g.append(f'<text x="{x+20}" y="{y+30+lh*i}" xml:space="preserve">{spans}</text>')
    g.append("</g>")
    return "".join(g)


SHORT = [
    [("import", "kw"), (" { deepseek } ", "plain"), ("from", "kw"), (" '@ai-sdk/deepseek'", "str")],
    [("chat", "fn"), ("({", "plain")],
    [("  adapter: ", "plain"), ("aiSdkText", "fn"), ("(", "plain"), ("deepseek", "fn"), ("(", "plain"), ("'deepseek-chat'", "str"), (")),", "plain")],
    [("  messages,", "plain")],
    [("})", "plain")],
]

LONG = [
    [("import", "kw"), (" { chat } ", "plain"), ("from", "kw"), (" '@tanstack/ai'", "str")],
    [("import", "kw"), (" { aiSdkText } ", "plain"), ("from", "kw"), (" '@amjadiqbal/tanstack-ai-sdk-bridge'", "str")],
    [("import", "kw"), (" { deepseek } ", "plain"), ("from", "kw"), (" '@ai-sdk/deepseek'", "str")],
    [("", "plain")],
    [("chat", "fn"), ("({ adapter: ", "plain"), ("aiSdkText", "fn"), ("(", "plain"), ("deepseek", "fn"), ("(", "plain"), ("'deepseek-chat'", "str"), (")), messages })", "plain")],
    [("// streaming, tools, reasoning, usage, abort", "dim")],
]


def banner(c):
    return f'''<svg width="1200" height="300" viewBox="0 0 1200 300" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{c["bg1"]}"/><stop offset="1" stop-color="{c["bg2"]}"/></linearGradient></defs>
  <rect width="1200" height="300" fill="url(#bg)"/>
  <g transform="translate(60,75) scale({150/512:.5f})">{icon_body()}</g>
  <text x="238" y="98" font-family="{MONO}" font-size="16" font-weight="600" fill="{c["accent"]}">for TanStack AI 1.x</text>
  <text x="235" y="160" font-family="{SANS}" font-size="64" font-weight="700" fill="{c["text"]}">AI SDK Bridge</text>
  <text x="238" y="198" font-family="{SANS}" font-size="22" font-weight="500" fill="{c["sub"]}">Any AI SDK provider as a TanStack AI adapter</text>
  {chips(238, 220, ["chat + tools", "embeddings", "speech · transcription · image"], c)}
  {code_card(770, 58, 390, c, SHORT, size=12, lh=22)}
  <text x="1160" y="275" text-anchor="end" font-family="{SANS}" font-size="15" fill="{c["foot"]}">amjadiqbal/tanstack-ai-sdk-bridge</text>
</svg>
'''


def social(c):
    return f'''<svg width="1280" height="640" viewBox="0 0 1280 640" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{c["bg1"]}"/><stop offset="1" stop-color="{c["bg2"]}"/></linearGradient></defs>
  <rect width="1280" height="640" fill="url(#bg)"/>
  <g transform="translate(80,80) scale({176/512:.5f})">{icon_body()}</g>
  <text x="292" y="116" font-family="{MONO}" font-size="20" font-weight="600" fill="{c["accent"]}">{NAME}</text>
  <text x="288" y="196" font-family="{SANS}" font-size="78" font-weight="700" fill="{c["text"]}">AI SDK Bridge</text>
  <text x="292" y="244" font-family="{SANS}" font-size="28" font-weight="500" fill="{c["sub"]}">Use any Vercel AI SDK provider with TanStack AI</text>
  {chips(80, 300, ["DeepSeek", "Anthropic", "OpenAI", "Together AI", "Cerebras", "Fireworks", "Ollama"], c, size=18, h=40, gap=12, cw=10.2)}
  {chips(80, 352, ["tested provider packages · AI SDK spec v2, v3, v4"], c, size=18, h=40, gap=12, cw=10.2)}
  {code_card(80, 418, 1120, c, LONG[:3] + LONG[4:6], size=18, lh=27)}
  <text x="1200" y="614" text-anchor="end" font-family="{SANS}" font-size="20" fill="{c["foot"]}">Free and open source · MIT · by Amjad</text>
</svg>
'''


def write(name, svg):
    with open(os.path.join(OUT, name), "w") as f:
        f.write(svg)


write("icon.svg", icon_svg())
write("banner-dark.svg", banner(DARK))
write("banner-light.svg", banner(LIGHT))
write("social-preview.svg", social(DARK))
print("wrote SVGs to", OUT)
