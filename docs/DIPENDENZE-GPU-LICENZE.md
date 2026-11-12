# Vehicle3D AI – Dipendenze, requisiti GPU e licenze

Architettura **free-first**: nessun servizio a pagamento è usato o richiesto, nessun credito viene acquistato automaticamente.
Tutte le chiavi opzionali appartengono a piani **gratuiti**.

## 1. Fonti dati e servizi esterni

| Fonte | Uso | Accesso | Licenza dei contenuti | Limiti noti |
| --- | --- | --- | --- | --- |
| Wikidata | identificazione per nome, dimensioni, anni, categoria, varianti, elenco modelli (SPARQL) | API pubblica, senza chiave | CC0 | rate limit per IP (429 con `Retry-After`); su IP cloud condivisi può richiedere attese |
| Wikipedia (it/en) | sintesi e documentazione | API REST pubblica | CC BY-SA 4.0 | come sopra |
| Wikimedia Commons | foto per vista (categoria del veicolo), modelli 3D STL | API pubblica | **per file** (CC0, PD, CC BY, CC BY-SA, GFDL…) – letta e conservata per ogni file | `upload.wikimedia.org` applica limiti severi agli IP cloud condivisi (osservato `Retry-After: 600`) |
| Poly Haven | texture PBR (tessuti, pelle, metalli) | API pubblica, senza chiave | CC0 | nessuna texture di pneumatici nel catalogo → materiale procedurale |
| Sketchfab | ricerca e download di modelli 3D | ricerca pubblica; **download con token di un account gratuito** (`SKETCHFAB_API_TOKEN`) | per modello (CC0, CC BY, BY-SA, BY-NC, BY-ND…, Standard/Editorial) | i modelli a pagamento non vengono mai acquistati né scaricati |
| GitHub | modelli 3D e addon Bedrock in repository pubblici | API pubblica (10 ricerche/min senza token; `GITHUB_TOKEN` gratuito alza i limiti) | licenza **del repository** (SPDX) | repository senza licenza = tutti i diritti riservati → esclusi. La licenza del repository potrebbe non coprire asset con licenza propria: verificare la pagina |
| Hugging Face Spaces | generazione AI (TRELLIS, TRELLIS.2) | gratuito con quota ZeroGPU; `HF_TOKEN` gratuito per la quota dell'account | modelli MIT | code e quota giornaliera: quando esaurita il motore lo segnala e prova l'alternativa |
| Google Programmable Search | ricerca immagini aggiuntiva (opzionale) | piano gratuito 100 query/giorno | per immagine (spesso sconosciuta → non usata per derivati) | |
| Brave Search | ricerca immagini aggiuntiva (opzionale) | piano gratuito | come sopra | |
| Bing Search API | – | **non disponibile**: ritirata da Microsoft ad agosto 2025 | | |
| CGTrader, MCPEDL | solo link di ricerca manuale | nessuna API pubblica gratuita; i termini vietano lo scraping | | non interrogati automaticamente |
| CurseForge | – | API con chiave soggetta ad approvazione | | non integrato |

## 2. Motori di acquisizione 3D

| Motore | Cosa fa | Dove gira | Requisiti |
| --- | --- | --- | --- |
| **A – Generazione AI** | immagine/i → mesh 3D | Spaces Hugging Face gratuiti oppure `ai-worker/` self-hosted | vedi tabella modelli |
| **B – Blender** | import FBX/BLEND/OBJ/STL/glTF, pulizia, decimazione, separazione parti, texture baking | `blender/` (container) – non su Vercel | CPU; `bpy` 5.3 (pip) o Blender 4.x/5.x |
| **C – Modelli esterni** | Sketchfab, Commons 3D, GitHub → GLB | server Next.js | token Sketchfab gratuito per scaricare |
| **D – Addon Minecraft** | addon Bedrock con licenza → riuso di geometria/texture, nuovo comportamento guidabile, crediti mantenuti | server Next.js | – |

### Modelli AI open source (licenze verificate sui file LICENSE)

| Modello | Licenza | Uso dell'output | GPU consigliata | Stato in Vehicle3D AI |
| --- | --- | --- | --- | --- |
| TRELLIS.2 (Microsoft) | MIT | libero, anche commerciale | NVIDIA ≥ 24 GB VRAM | abilitato (Space `microsoft/TRELLIS.2`) |
| TRELLIS (Microsoft) | MIT | libero, anche commerciale; multi-immagine | NVIDIA ≥ 16 GB VRAM | abilitato (Space `trellis-community/TRELLIS`) |
| TripoSR (Stability AI + Tripo) | MIT | libero | nessuna obbligatoria: CPU (minuti) o GPU ≥ 6 GB (secondi) | worker self-hosted (`ai-worker/`) |
| Hunyuan3D-2 (Tencent) | Tencent Hunyuan Community License | **la licenza esclude UE, Regno Unito e Corea del Sud** | NVIDIA ≥ 16 GB VRAM | **disabilitato** (attivabile solo con `ALLOW_REGION_RESTRICTED_MODELS=true` fuori da quei territori) |
| CLIP ViT-B/32 (OpenAI) | MIT | riconoscimento foto e viste nel browser | nessuna (WASM/WebGPU nel telefono, ~90 MB una volta) | abilitato |

Nota: le licenze dei software e dei modelli non sono tutte uguali. Prima di aggiungere un modello verificare il file LICENSE del repository **e** dei pesi (model card).

## 3. Politica di licenza applicata dal codice (`src/lib/licenses.ts`)

- Licenza assente o non riconosciuta = tutti i diritti riservati → **non utilizzabile**.
- ND (no derivati) → conversione bloccata.
- NC (non commerciale) → consentito solo se l'utente non dichiara uso commerciale.
- SA (share-alike) → il risultato eredita la licenza; licenze SA diverse sono incompatibili.
- Sketchfab Standard/Editorial → non ridistribuibili nel pacchetto.
- Immagini usate come input della generazione AI → devono consentire opere derivate.
- Le licenze dei candidati scelti dal client vengono **riverificate alla fonte dal server**.
- Crediti inclusi in `CREDITS.txt` (dentro .mcaddon e ZIP OBJ), in `asset.copyright`/`extras` del GLB e negli autori dei manifest Bedrock.
- Se la verifica dei diritti fallisce l'esportazione viene impedita (HTTP 451, nessun file salvato).

## 4. Dipendenze software principali

| Pacchetto | Versione | Licenza | Uso |
| --- | --- | --- | --- |
| next / react | 15.5 / 19.1 | MIT | applicazione web |
| @gltf-transform/* | 4.5 | MIT | lettura/scrittura/ottimizzazione glTF |
| meshoptimizer | 1.3 | MIT | semplificazione mesh |
| draco3dgltf | 1.5 | Apache-2.0 | decompressione Draco |
| gltf-validator (Khronos) | 2.0-dev | Apache-2.0 | verifica dei GLB prodotti |
| sharp | 0.35 | Apache-2.0 (libvips LGPL-3.0) | immagini e texture |
| jszip | 3.10 | MIT o GPL-3.0 (scelta MIT) | MCADDON e ZIP |
| three, @react-three/fiber, drei | 0.187 / 9.8 / 10.7 | MIT | anteprime 3D |
| @gradio/client | 2.7 | ISC | Spaces Hugging Face |
| @huggingface/transformers | 4.3 | Apache-2.0 | CLIP nel browser |
| @vercel/blob | 2.9 | Apache-2.0 | archiviazione su Vercel (piano gratuito disponibile) |
| zod | 4.6 | MIT | validazione input |
| bpy (Blender) | 5.3 | GPL-3.0 | worker Blender (processo separato) |
| torch, transformers, rembg, trimesh, scikit-image | – | BSD/Apache/MIT | worker AI TripoSR |

## 5. Requisiti per ambiente

| Ambiente | Cosa serve |
| --- | --- |
| Solo smartphone + Vercel | account Vercel gratuito, Blob Store. Funzionano: ricerca, fonti, conversioni, motore C (con token Sketchfab), D, A tramite Spaces (con quota) |
| Worker Blender | container con 2 vCPU / 4 GB RAM (`blender/Dockerfile`) |
| Worker AI TripoSR CPU | 4 vCPU / 8 GB RAM, ~3 GB disco per pesi; 1–3 minuti per modello |
| Worker AI GPU (TRELLIS) | NVIDIA ≥ 16 GB VRAM (24 GB per TRELLIS.2), CUDA 12 |
