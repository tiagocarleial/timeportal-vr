# TimePortalVR

Plataforma de experiências históricas em VR — panoramas 360° de momentos como o Dia D, Roma Antiga, Apollo 11 — navegáveis via web, WebXR (Meta Quest) e um hub central em forma de globo 3D.

## Status

### Feito

- **Direção visual** — sistema de design "instrumento + atlas de expedição" (tinta azul-escura + latão), tipografia Fraunces/IBM Plex, tokens de tema claro/escuro. Mockup das 4 telas principais (Home, Categoria, Experiência/Viewer, Admin).
- **Frontend Angular** (`src/`) — scaffold Angular 22 standalone, estrutura `core/shared/features`, roteamento (`/`, `/category/:slug`, `/experience/:slug`, `/explore`), `Catalog` service com dados mock (5 categorias, 9 experiências com coordenadas reais).
  - Home, Category, Experience: páginas 2D funcionais com o design aplicado.
  - **Globe Hub** (`/explore`) — cena Three.js com globo 3D (textura de continentes gerada a partir de mapa de relevo real, tintada em latão), marcadores por lat/long, filtro por era.
  - **WebXR imersivo** — sessão `immersive-vr` real: ray de controle, globo e panorama fundidos numa cena só (nunca sai da sessão XR ao trocar de experiência), transição por fade-to-ink, retorno ao globo via botão grip. Fallback desktop com OrbitControls/mouse na mesma cena.
    - **Controles VR** — no globo: segurar o gatilho no espaço vazio e varrer o controle **agarra e gira** o globo (gesto principal); gatilho apontado num marcador **abre** a experiência (clique, não arrasto); thumbstick continua como conforto (horizontal gira, vertical dá zoom); sem input, auto-rotação lenta. No panorama: thumbstick esquerda/direita **gira a imagem 360** ao seu redor, sem precisar virar o corpo. Grip volta ao globo.
    - **Tooltips in-scene** — mirar num marcador do globo mostra um rótulo flutuante (título + ano/local); mirar num hotspot do panorama mostra título + descrição. Renderizado como sprite no mundo 3D, então aparece dentro do headset (o HUD em DOM não é visível em VR).
  - Panoramas: o Globe Hub carrega `public/panoramas/<slug>.jpg` quando existe, com o gradiente procedural por categoria entrando na hora e ficando de pé se o arquivo faltar. Hoje só `d-day-omaha-beach` tem foto real; as outras 8 seguem no gradiente. Cards 2D ainda não usam as fotos.
- **Pipeline de geração de imagem** (`pipeline/`) — ComfyUI clonado, venv Python 3.12, PyTorch ROCm nightly nativo para GPU AMD RDNA3 (RX 7900 XTX, sem ZLUDA). GPU verificada (`torch.cuda.is_available() == True`, 25.8 GB VRAM). Servidor sobe e responde.
  - **Workflow de panorama montado** (`pipeline/workflows/`) — três passadas em formato API, validadas contra o `/object_info` do ComfyUI (todos os nós e inputs conferem): `01_txt2img` (FLUX 2048×1024 equirect), `02_seamfix` (conserta a emenda do wrap horizontal), `03_upscale` (RealESRGAN 4× → 8192×4096, reamostrado pra 4096×2048 na saída).
  - **Driver** (`pipeline/generate_panorama.py`) — orquestra as três passadas via API HTTP, faz o roll/inpaint/roll-back da emenda, e grava JPEG com metadados XMP GPano em `public/panoramas/<slug>.jpg`. Lógica pura (roll, máscara, GPano) testada.
  - **Downloader** (`pipeline/download_models.py`) — baixa os pesos. **Sem login no HuggingFace**: usa o repack all-in-one `Comfy-Org/flux1-dev/flux1-dev-fp8.safetensors` (17.3 GB, ungated, já inclui transformer + clip_l + t5xxl + VAE). Escolhido sobre o fp16 porque fp16 pede ~34 GB e a placa tem 25.8 GB — rodaria com offload pra RAM a cada passo.
  - **Pesos no disco** — `flux1-dev-fp8.safetensors` (16.4 GB), `equirectangular_flux_lora_v3.safetensors` (328 MB), `RealESRGAN_x4plus.pth` (64 MB).
  - **LoRA equirect** — `MultiTrickFox/Flux-LoRA-Equirectangular-v3`, em `models/loras/`. É a peça que faz a projeção existir; ver a seção abaixo antes de mexer no workflow.
  - **Pipeline rodou fim-a-fim** — `public/panoramas/d-day-omaha-beach.jpg`, 4096×2048, seed 42, três passadas.

### Faltando

- **Fechar a força do LoRA** — em 1.0 a projeção sai certa mas o LoRA atropela o conteúdo do prompt: a primeira geração perdeu as barcaças em chamas, os balões de barragem e os respingos de morteiro, virando uma praia calma com figurantes. Tentar `--lora-strength 0.7`, subindo `--guidance` se a aderência ainda faltar.
- **Gerar as outras 8 experiências** — só depois de fechar a força, senão regera tudo. ~5 min cada. Vale um script lendo os slugs de `catalog.ts` em vez de 8 comandos na mão.
- **Cards 2D com foto real** — `home` e `category` ainda mostram gradiente; só o Globe Hub carrega as fotos.
- **`d-day.jpg`** — sobra da primeira geração (8K, prompt antigo, antes do LoRA). Apagar quando não servir mais de comparação.
- **Backend Spring Boot** — nada implementado ainda. Sem Java/Maven instalados na máquina; decisão pendente (instalar local vs. só preparar os arquivos).
- **Admin panel** — desenhado no mockup, sem implementação Angular.
- **Áudio espacial / narração** — mencionado no roadmap, não iniciado.
- **Hotspots com conteúdo real** — hoje só existem 2 hotspots de exemplo (D-Day); textos/pontos de interesse dos outros eventos não escritos.

### Possíveis próximos passos

1. Fechar a força do LoRA (conteúdo vs. projeção) e gerar as outras 8 experiências em lote.
2. Usar as fotos reais também nos cards 2D de `home` e `category`.
3. Backend Spring Boot (API `/api/categories`, `/api/experiences`, `/api/admin/generate` etc., conforme arquitetura desenhada) — depende de decisão sobre Java local.
4. Implementar o Admin panel em Angular, ligado ao pipeline de geração.
5. Popular hotspots e descrições históricas reais para as demais experiências.

## Estrutura

```
src/app/
  core/            modelos (Experience, Category) e services (Catalog)
  shared/          navbar, footer, cards, timeline
  features/
    home/          catálogo + linha do tempo
    category/      grid de experiências por categoria
    experience/    viewer 360° 2D (HUD, hotspots, narração)
    globe/         Globe Hub — cena Three.js/WebXR (globo + panorama fundidos)
pipeline/
  ComfyUI/                 servidor de geração (FLUX.1-dev fp8, PyTorch ROCm)
    models/loras/          LoRA equirect — sem ele não existe projeção 360
  workflows/               as três passadas em formato API
  download_models.py       baixa os pesos (sem login no HuggingFace)
  generate_panorama.py     prompt -> panorama 8K equirect com GPano
public/
  fonts/           Fraunces, IBM Plex Sans/Mono (self-hosted)
  textures/        máscara de continentes pro globo
```

## Desenvolvimento — Frontend

```bash
npm install
ng serve
```

Abra `http://localhost:4200`. Rotas principais: `/` (home), `/explore` (Globe Hub, testável com o [WebXR emulator](https://chromewebstore.google.com/detail/immersive-web-emulator) sem headset), `/category/:slug`, `/experience/:slug`.

```bash
ng build   # build de produção em dist/
ng test    # testes unitários (Vitest)
```

## Desenvolvimento — Pipeline de geração (ComfyUI)

```bash
# 1. baixar os pesos (~17.4 GB, uma vez só, sem login)
pipeline\ComfyUI\venv\Scripts\python.exe pipeline\download_models.py

# 2. subir o servidor e deixar rodando
cd pipeline\ComfyUI && .\venv\Scripts\python.exe main.py

# 3. em outro terminal, gerar um panorama
pipeline\ComfyUI\venv\Scripts\python.exe pipeline\generate_panorama.py ^
    --slug d-day ^
    --prompt "Omaha Beach, 6 de junho de 1944, rampas das barcaças baixando, fumaça sobre a areia"
```

Sai em `public/panoramas/d-day.jpg`, 4096×2048, com XMP GPano. O upscale continua indo a 8192×4096 e é reamostrado pra 4K na saída — passar do alvo e voltar limpa artefato do upscaler. `--max-width 0` guarda o 8K inteiro. Para uma conferida rápida sem esperar as três passadas: `--width 1024 --height 512 --no-seam-fix --no-upscale`.

O prompt não precisa mencionar 360°/equirect — o driver já embrulha o texto com as instruções de projeção.

GPU AMD RDNA3 sem suporte oficial pode precisar de `HSA_OVERRIDE_GFX_VERSION=11.0.0` antes do passo 2.

### O LoRA equirect não é opcional

FLUX.1-dev não sabe fazer projeção equiretangular. Pedir no prompt — "equirectangular 360 degree spherical panorama", "full 360x180 view", o que for — devolve uma **fotografia panorâmica comum em 2:1**, que engana em miniatura e desmonta no headset:

- céu chapado no topo em vez de zênite esticado na largura inteira
- chão em perspectiva na base em vez de nadir
- uns 90° de conteúdo onde precisa de 360, sem volta fechada

Numa esfera isso vira 90° espremidos em 360° na horizontal e 60° esticados em 180° na vertical. Foi assim que o projeto passou uma rodada inteira de calibração de prompt ajustando conteúdo em cima de geometria errada — o prompt nunca foi o problema.

Quem resolve é o LoRA (`models/loras/equirectangular_flux_lora_v3.safetensors`), enxertado como `LoraLoader` nas passadas 1 **e** 2. A passada 2 também precisa: sem ele o inpaint da emenda repinta o miolo em projeção de foto normal.

A frase-gatilho `equirectangular 360 degree panorama` tem que aparecer **literal** no prompt. O `EQUIRECT_SUFFIX` já cuida disso — mas cuidado ao reescrever: a versão anterior dizia "360 degree **spherical** panorama", que lê igual pra humano e não casa com o gatilho.

### Calibração de prompt (seed 42, comparações controladas)

- **Âncoras de polo pioram.** `open sky overhead, continuous ground below` foram removidas: esvaziam a cena numa praia nua com céu vazio, e os polos não ficam pior sem elas. Não colocar de volta.
- **Ordem do prompt é indiferente.** Cena-primeiro e projeção-primeiro deram o mesmo resultado em seed fixa. Cena-primeiro ficou só porque lê melhor.
- **Guidance 3.5 > 5.5** pra luz de dia encoberto; 5.5 satura e endurece o contraste.
- **Prompt em inglês.** O mesmo texto em português vira praia ensolarada e calma — a especificidade histórica é a primeira coisa que se perde.

### Armadilha: dev server não vê arquivo novo em `public/`

O `ng serve` indexa `public/` no boot. Panorama gerado com o servidor rodando dá **404** e o loader cai no gradiente sem avisar — parece que a foto "não apareceu". Sobrescrever um arquivo que já existia funciona normal; o problema é só nome novo. Gerou slug novo, reinicia o `ng serve`.

### Armadilha: Smart App Control x pyav

O Smart App Control do Windows está **ligado** nesta máquina (`VerifiedAndReputablePolicyState = 1`) e bloqueia DLLs sem assinatura/reputação. O `av` 18.0.0 é novo demais e cai nessa: o ComfyUI nem chega a subir, morre com

```
ImportError: DLL load failed while importing codeccontext: Uma política de Controle de Aplicativo bloqueou este arquivo.
```

O `av` está fixado em **17.0.0**, que carrega normal e satisfaz o `av>=16.0.0` do `requirements.txt`. Cuidado: rodar `pip install -r requirements.txt` atualiza pro 18 e quebra tudo de novo. Se acontecer:

```bash
.\venv\Scripts\python.exe -m pip install "av==17.0.0"
```

Desligar o Smart App Control também resolveria, mas é **irreversível** — só volta a ligar reinstalando o Windows do zero. Não vale a pena por causa disso.
