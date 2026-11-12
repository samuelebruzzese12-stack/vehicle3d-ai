# Vehicle3D AI

Da una fotografia di un veicolo (auto, camion, autobus, moto…) a un modello 3D con carrozzeria, componenti separati e abitacolo, esportato in **GLB**, **OBJ** e **MCADDON per Minecraft Bedrock (Android 1.21+)**.

Interfaccia in italiano, mobile-first, utilizzabile interamente da smartphone: l'app gira su Vercel e non serve un PC.

## Flusso

1. **Foto** – scatto o galleria; ridimensionamento nel browser (max 1600 px) per restare nei limiti di Vercel.
2. **Identificazione** – Claude (vision) stima marca, modello, anni, categoria, dimensioni reali e posti. I dati sono modificabili; senza chiave si inseriscono a mano.
3. **Riferimenti** – ricerca automatica per vista (anteriore, posteriore, laterale, tre quarti, superiore, interni, plancia) su Wikimedia Commons (senza chiave, con licenza e autore), più Brave Image Search e Google CSE se configurati. Le immagini selezionate vengono **scaricate e decodificate dal server** (controllo tecnico) e, con la chiave Anthropic, verificate da Claude (stesso modello? quale vista? qualità?).
4. **Generazione 3D** – provider intercambiabile: **Meshy Multi-Image to 3D** (fino a 4 viste) o **fal.ai Hunyuan3D v2 multi-view**. Il task è asincrono: lo stato viene salvato nel browser e si può chiudere la pagina.
5. **Elaborazione** (server) – il modello viene scaricato **dal provider tramite l'ID del task** (mai da un URL fornito dal client), poi:
   - normalizzazione: Y in alto, lunghezza su Z, scala reale (1 blocco Minecraft = 1 m), appoggio a terra;
   - riconoscimento anteriore/posteriore dai fanali, con rotazione automatica (o scelta manuale);
   - ottimizzazione mesh (dedup, weld, semplificazione meshoptimizer) e texture (max 2K);
   - pulizia opzionale con **Blender** (worker esterno);
   - segmentazione: ruote (con pivot sul mozzo), vetri (materiale trasparente), fari, fanali, porte;
   - abitacolo: sedili, plancia e volante ricostruiti proceduralmente dalle proporzioni, con colori presi dalle foto degli interni;
   - voxelizzazione a 1 pixel Minecraft, palette colori, greedy meshing in cubi Bedrock, un bone per componente, ruote animate;
   - **verifica di ogni output** prima di renderlo scaricabile.
6. **Risultato** – anteprima 3D interattiva del GLB (componenti attivabili), anteprima Minecraft ricostruita dalla geometria Bedrock, download e checklist dei controlli.

## Stato delle funzioni (cosa è stato testato davvero)

| Funzione | Stato |
| --- | --- |
| Interfaccia mobile (Pixel 7 emulato, Chromium) | ✅ testata end-to-end |
| Ricerca immagini Wikimedia Commons | ✅ testata con richieste reali |
| Download/validazione riferimenti e miniature via server | ✅ testata con richieste reali |
| Pipeline GLB → GLB/OBJ/MCADDON + verifica | ✅ testata su modelli reali (Ferrari three.js compressa Draco, ToyCar Khronos) e su un veicolo sintetico (test automatici) |
| Validatore glTF Khronos sui GLB prodotti | ✅ 0 errori |
| Script Blender e worker | ✅ testati con `bpy` 5.3 |
| Identificazione e verifica con Claude | ⚠️ codice completo, **non eseguito** (nessuna chiave Anthropic disponibile durante lo sviluppo) |
| Generazione Meshy | ⚠️ endpoint verificati (rispondono), **generazione non eseguita**: la chiave fornita è stata rifiutata (401) |
| Generazione fal.ai | ⚠️ codice completo, **non eseguito** (nessuna chiave) |
| Brave / Google CSE | ⚠️ codice completo, non eseguito (nessuna chiave) |
| Caricamento in Minecraft Bedrock | ⚠️ struttura del pacchetto verificata automaticamente (JSON, UUID, dipendenze, geometria, texture, render controller, animazioni); **non provato in gioco** |

### Limiti noti

- I generatori image-to-3D producono il guscio esterno: l'abitacolo è una **stima procedurale**, non una ricostruzione fotografica.
- La separazione dei componenti è **euristica** (geometria + colore): funziona bene sulle ruote, è approssimativa su porte e fari.
- In Minecraft il veicolo è fatto di cubi: alla qualità ULTRA un'auto produce ~6.000 cubi. Su telefoni economici possono servire impostazioni più leggere (ALTA/STANDARD); oltre 7.000 cubi la risoluzione si adatta automaticamente.
- Su Vercel il caricamento diretto di un GLB proprio (“Converti GLB”) è limitato a ~4,5 MB per richiesta.

## Deploy su Vercel (solo smartphone)

1. Apri [vercel.com](https://vercel.com) dal browser del telefono, accedi con GitHub e scegli **Add New → Project** → importa questo repository.
2. In **Storage** crea un **Blob Store** e collegalo al progetto (imposta da solo `BLOB_READ_WRITE_TOKEN`). È obbligatorio su Vercel: i file generati vengono salvati lì.
3. In **Settings → Environment Variables** aggiungi le chiavi (vedi `.env.example`):
   - `ANTHROPIC_API_KEY` – identificazione e verifica riferimenti;
   - `MESHY_API_KEY` e/o `FAL_KEY` – generazione 3D;
   - `APP_ACCESS_CODE` – **consigliato**: senza, chiunque abbia il link può consumare i tuoi crediti. Il codice si inserisce in *Impostazioni* nell'app.
4. **Deploy**. Le funzioni di elaborazione usano fino a 300 s (`maxDuration`), compatibile con il piano Hobby con Fluid Compute.
5. Apri l'URL del progetto dal telefono (puoi aggiungerlo alla schermata Home).

### Installazione del pacchetto in Minecraft (Android)

Scarica il `.mcaddon`, aprilo e scegli Minecraft: Resource Pack e Behavior Pack vengono importati. Attivali entrambi nel mondo, poi usa l'uovo generatore o `/summon vehicle3d:<id>` (l'id è nel risultato). Tocca il veicolo per salire; il primo posto guida.

## Worker Blender (opzionale)

Vercel non può eseguire Blender. Se vuoi la pulizia mesh con Blender, pubblica `blender/` come container (Render, Fly.io, Cloud Run…):

```
docker build -t vehicle3d-blender blender/
docker run -e BLENDER_WORKER_TOKEN=un-segreto -p 8080:8080 vehicle3d-blender
```

poi imposta `BLENDER_WORKER_URL` e `BLENDER_WORKER_TOKEN` su Vercel. Se il worker non risponde, la pipeline prosegue senza ed è indicato nel report. Lo script si può usare anche a mano: `blender -b -P blender/process_vehicle.py -- in.glb out.glb --target-tris 300000`.

## Sviluppo

```
npm install
cp .env.example .env.local   # compila le chiavi
npm run dev
npm test          # test della pipeline (nessuna rete necessaria)
npm run typecheck && npm run lint && npm run build
```

La CI GitHub Actions esegue typecheck, lint, test, build e lo script Blender a ogni push.

### Architettura

```
src/app/api/            route server-side (le chiavi non arrivano mai al browser)
  identify              Claude vision → marca/modello/anno/dimensioni
  references/search     Wikimedia + Brave + Google, query per vista
  references/verify     download reale + classificazione AI delle viste
  generate, generate/[taskId]   creazione e stato del task del provider
  process               download dal provider → pipeline → verifica → storage
  convert               pipeline su un GLB caricato
  thumb                 miniature servite dal server
src/lib/providers/      interfaccia ModelProvider + Meshy + fal.ai
src/lib/mesh/           IO glTF, normalizzazione, segmentazione, abitacolo, OBJ, Blender
src/lib/minecraft/      voxelizzazione, palette, greedy meshing, Resource/Behavior Pack, MCADDON
src/lib/verify.ts       verifiche GLB (validatore Khronos), OBJ, MCADDON
blender/                script Blender, worker HTTP, Dockerfile
scripts/render-geo.mts  rendering di controllo di una geometria Bedrock (lato/fronte/alto)
```

Sicurezza: validazione degli input con zod, protezione SSRF sui download (solo https, niente IP privati, limiti di dimensione e timeout), host dei modelli in allowlist per provider, rate limit per IP, codice di accesso opzionale per le operazioni a pagamento, nessun file reso scaricabile se non supera la verifica.

Minecraft è un marchio di Mojang Studios/Microsoft; questo progetto non è affiliato.
