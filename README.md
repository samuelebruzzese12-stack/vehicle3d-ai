# Vehicle3D AI

Dal **nome** o da una **foto** di un veicolo (auto, camion, autobus, carro armato…) a un modello 3D con carrozzeria, componenti separati e abitacolo, esportato in **GLB**, **OBJ** e **MCADDON per Minecraft Bedrock (Android 1.21+)**.

Architettura **free-first**: nessun servizio a pagamento, nessun acquisto automatico di crediti. Fonti aperte, modelli AI open source, licenze verificate per ogni risorsa. Interfaccia in italiano, mobile-first, utilizzabile solo da smartphone (deploy su Vercel).

Dipendenze, requisiti GPU e licenze: **[docs/DIPENDENZE-GPU-LICENZE.md](docs/DIPENDENZE-GPU-LICENZE.md)**.

## Come funziona

1. **Veicolo**
   - *Nome*: Wikidata + Wikipedia identificano marca, modello, categoria, anni, dimensioni reali, massa, equipaggio, varianti.
   - *Foto*: riconoscimento con **CLIP (MIT) nel browser** (la foto non lascia il telefono): categoria, marca e 5 modelli probabili presi da Wikidata. È una stima: l'utente conferma.
2. **Fonti** – foto per vista da Wikimedia Commons (categoria ufficiale del veicolo), viste stimate con CLIP, texture CC0 da Poly Haven, modelli 3D (Sketchfab, Commons 3D, GitHub), addon Minecraft (GitHub). Per ogni risorsa: autore, fonte, licenza, utilizzabilità. Link di ricerca manuale per siti senza API (CGTrader, MCPEDL).
3. **Costruzione** – motore automatico o manuale:
   - **C** modello 3D esistente con licenza compatibile → **D** addon Minecraft esistente → **A** generazione AI open source (TRELLIS / TRELLIS.2, MIT). Se un motore fallisce si passa al successivo; ogni tentativo è mostrato.
   - **B** Blender: FBX/BLEND/OBJ/STL/glTF → pulizia, separazione parti, texture baking.
   - Livrea: originale, vernice, 5 mimetiche procedurali; texture reali CC0 sui sedili.
4. **Risultato** – anteprima 3D (componenti attivabili) e Minecraft, **tabella delle parti: ricostruite dal sorgente / separate con euristica / stimate / non presenti**, licenze e crediti, download verificati.

Regole che il codice rispetta:
- gli interni non sono mai dichiarati completi; motore e componenti non documentati non vengono inventati;
- licenze sconosciute, ND, NC (se uso commerciale), share-alike incompatibili → **esportazione bloccata**;
- le licenze dei candidati scelti dal client sono **riverificate dal server alla fonte**;
- crediti in `CREDITS.txt` (MCADDON e ZIP OBJ), nei metadati del GLB e nei manifest Bedrock;
- nessun file è scaricabile se non supera la verifica (validatore glTF Khronos, controlli OBJ e MCADDON).

## Risultati dei test (eseguiti realmente il 12/11/2026)

### Test richiesti

| # | Test | Esito | Dettagli |
| --- | --- | --- | --- |
| 1 | Ricerca per nome **T-90** | ✅ superato (live) | Q192757, carro armato, Uralvagonzavod, dal 1991, 9,53 × 3,78 × 2,22 m, 46,5 t, categoria Commons "T-90 tanks", sintesi Wikipedia IT/EN |
| 2 | Ricerca per nome **Alfa Romeo 159** | ✅ superato (live) | Q1610, marca "Alfa Romeo" (proprietà brand), modello "159", 4,661 × 1,83 × 1,417 m, anni 2005–2011 ricavati dal testo Wikipedia (Wikidata non li ha) |
| 3 | Fotografie e texture | ⚠️ parziale (live) | ✅ 40 foto con licenza da "T-90 tanks" e "Alfa Romeo 159" (licenze riconosciute per >80%); ✅ texture CC0 per 5 slot, download e decodifica reali. ❌ un download da `upload.wikimedia.org` respinto: limite sull'IP condiviso del container (`Retry-After: 600`) |
| 4 | Recupero di un modello 3D esistente | ⚠️ parziale (live) | ✅ ricerca su 3 fonti e scarto dei modelli non pertinenti (per T-90 Commons propone Merkava/Leopard: correttamente esclusi). ❌ download non verificato in questo ambiente: token Sketchfab fornito non valido (401) e `upload.wikimedia.org` limitato. Import dei formati, blocco licenze e riverifica coperti dai test offline |
| 5 | Generazione AI senza provider a pagamento | ⚠️ non completato (live) | ✅ cascata TRELLIS.2 → TRELLIS eseguita realmente, Hunyuan3D escluso per licenza UE. ❌ entrambi gli Spaces gratuiti hanno risposto "quota ZeroGPU esaurita". Il worker locale TripoSR (MIT, CPU) è pronto ma la sua esecuzione in questo ambiente non è stata autorizzata |
| 6 | Elaborazione Blender | ✅ superato (live, bpy 5.3) | pulizia, separazione in 10 parti, texture baking (corretto un bug: i materiali metallici venivano cotti neri), conversione STL/FBX |
| 7 | Conversione Bedrock | ✅ superato | auto e carro armato: bone e genitori validi (cannone figlio della torretta), pivot, UV entro la texture, ≤ 7000 cubi |
| 8 | Esportazione e validazione MCADDON | ✅ superato | 16/16 controlli: JSON, RP+BP, UUID, dipendenze, motore ≥ 1.21, texture, render controller coerente, animazioni su bone esistenti, posti guidabili, lingue IT/EN |

### Altre verifiche

- 35 test offline (`npm test`): licenze, formati (MCADDON→glTF, OBJ, glTF zip, STL), pipeline, cingolati, livrea, riuso Bedrock, crediti, blocchi licenza.
- E2E su smartphone emulato (Pixel 7): nome → fonti reali → costruzione → risultato; percorso automatico T-90 con tentativi mostrati all'utente.
- Non verificato: caricamento del pacchetto dentro Minecraft (verificata solo la struttura); qualità della generazione AI su veicoli reali (nessuna generazione completata qui).

## Deploy su Vercel (solo smartphone)

1. Su [vercel.com](https://vercel.com) → **Add New → Project** → importa questo repository.
2. **Storage → Blob Store** collegato al progetto (piano gratuito): imposta `BLOB_READ_WRITE_TOKEN`.
3. **Environment Variables** (tutte gratuite e opzionali, vedi `.env.example`):
   - `APP_ACCESS_CODE` consigliato su un link pubblico;
   - `SKETCHFAB_API_TOKEN` (account Sketchfab gratuito → Settings → Password & API) per scaricare modelli CC;
   - `HF_TOKEN` (account Hugging Face gratuito, permesso *read*) per la quota GPU degli Spaces;
   - `GITHUB_TOKEN` (facoltativo) per limiti di ricerca più alti.
4. **Deploy**. Funzioni fino a 300 s (piano Hobby con Fluid Compute).

Limiti dei servizi gratuiti da conoscere: Wikimedia limita gli IP cloud condivisi; gli Spaces ZeroGPU hanno code e quota giornaliera; GitHub senza token consente 10 ricerche al minuto. L'app mostra sempre quale limite è stato raggiunto e quanto attendere.

## Worker opzionali (fuori da Vercel)

```
# Blender (motore B): pulizia, baking, FBX/BLEND
docker build -t vehicle3d-blender blender/ && docker run -e BLENDER_WORKER_TOKEN=segreto -p 8080:8080 vehicle3d-blender
# AI open source (motore A, TripoSR su CPU o GPU)
docker build -t vehicle3d-ai ai-worker/ && docker run -e AI_WORKER_TOKEN=segreto -p 8081:8081 vehicle3d-ai
```

Poi imposta `BLENDER_WORKER_URL`/`BLENDER_WORKER_TOKEN` e `AI_WORKER_URL`/`AI_WORKER_TOKEN`.

## Sviluppo

```
npm install
npm run dev
npm test            # 35 test offline
npm run test:live   # test con servizi reali (rete); il test 6 richiede BLENDER_WORKER_URL, il 5 TEST_PHOTO
npm run typecheck && npm run lint && npm run build
```

### Struttura

```
src/lib/sources/      Wikidata/Wikipedia, Commons (foto e 3D), Poly Haven, Sketchfab, GitHub, client HTTP con limiti
src/lib/engines/      orchestratore (C → D → A), acquisizione e riverifica, generazione AI, tabella modelli e licenze
src/lib/formats/      import GLB, glTF zip, OBJ/MTL, STL, FBX/BLEND (via Blender), MCADDON/MCPACK
src/lib/mesh/         normalizzazione, ottimizzazione, segmentazione (ruote / cingoli, torretta, cannone), abitacolo stimato
src/lib/materials/    preset PBR, livrea, mimetiche procedurali
src/lib/minecraft/    voxelizzazione, greedy meshing, geometria Bedrock, RP/BP, riuso addon, Bedrock → glTF
src/lib/licenses.ts   normalizzazione licenze, politica d'uso, crediti
src/lib/vision/       CLIP nel browser (riconoscimento foto e viste)
blender/              script e worker Blender
ai-worker/            worker TripoSR self-hosted
```

Minecraft è un marchio di Mojang Studios/Microsoft; questo progetto non è affiliato.
