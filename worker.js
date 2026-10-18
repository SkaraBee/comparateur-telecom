export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Création automatique de la table SQL au premier appel
    if (env.DB) {
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS quotes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider TEXT,
          tech TEXT,
          bandwidth TEXT,
          monthlyPrice REAL,
          setupFee REAL,
          promoPrice REAL,
          promoMonths INTEGER,
          commitment INTEGER,
          sla TEXT,
          backup TEXT,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `).run();
    }

    // --- API GROUPE 1 : EXTRACTION IA D'UN DEVIS BRUT + ENREGISTREMENT EN BDD ---
    if (url.pathname === "/api/extract" && request.method === "POST") {
      try {
        const { rawText } = await request.json();
        const prompt = `Tu es un expert Télécom. Extrais les informations de ce devis et réponds UNIQUEMENT avec un objet JSON valide (sans texte avant ni après, sans balises markdown) respectant exactement cette structure :
{"provider": "Nom opérateur et offre", "tech": "FTTO ou FTTH ou 5G ou Mobile", "bandwidth": "Débit ex 1 Gbps", "monthlyPrice": 350, "setupFee": 0, "promoPrice": 0, "promoMonths": 0, "commitment": 36, "sla": "GTR 4h ou GTR 8h ou Best Effort", "backup": "Oui ou Non"}
Voici le texte du devis : ${rawText}`;

        const aiResp = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1
        });

        // Nettoyage et lecture du JSON généré par l'IA
        const jsonMatch = aiResp.response.match(/\{[\s\S]*\}/);
        const data = JSON.parse(jsonMatch ? jsonMatch[0] : aiResp.response);

        return new Response(JSON.stringify({ success: true, extracted: data }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500 });
      }
    }

    // --- API : SAUVEGARDER OU LIRE LES DEVIS DANS LA BASE DE DONNÉES (D1) ---
    if (url.pathname === "/api/quotes") {
      if (request.method === "GET") {
        const { results } = await env.DB.prepare("SELECT * FROM quotes ORDER BY id DESC").all();
        return new Response(JSON.stringify(results), { headers: { "Content-Type": "application/json" } });
      }
      if (request.method === "POST") {
        const q = await request.json();
        await env.DB.prepare(`
          INSERT INTO quotes (provider, tech, bandwidth, monthlyPrice, setupFee, promoPrice, promoMonths, commitment, sla, backup)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(q.provider, q.tech, q.bandwidth, q.monthlyPrice, q.setupFee, q.promoPrice || 0, q.promoMonths || 0, q.commitment, q.sla, q.backup).run();
        return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
      }
      if (request.method === "DELETE") {
        const id = url.searchParams.get("id");
        if (id) {
          await env.DB.prepare("DELETE FROM quotes WHERE id = ?").bind(id).run();
        } else {
          await env.DB.prepare("DELETE FROM quotes").run();
        }
        return new Response(JSON.stringify({ success: true }));
      }
    }

    // --- API GROUPE 2 : COMPARAISON INTELLIGENTE DES DEVIS PAR L'IA ---
    if (url.pathname === "/api/compare-ai" && request.method === "POST") {
      const { quotes } = await request.json();
      const prompt = `Tu es un consultant Télécom B2B. Compare ces offres (en tenant compte du TCO lissé, des FAS, de la technologie FTTO dédiée vs FTTH mutualisée, et de la GTR). Rédige une recommandation claire en 3 points courts (1. Analyse financière TCO, 2. Analyse technique & risques, 3. Verdict final) en français : ${JSON.stringify(quotes)}`;
      const aiResp = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: [{ role: "user", content: prompt }]
      });
      return new Response(JSON.stringify({ analysis: aiResp.response }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // --- INTERFACE WEB (DIVISÉE EN PÔLE 1 : EXTRACTION & PÔLE 2 : COMPARAISON) ---
    return new Response(HTML_PAGE, { headers: { "content-type": "text/html;charset=UTF-8" } });
  }
};

const HTML_PAGE = `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TelecomCompare AI & DB - Projet Étudiant</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>.best-offer { border: 2px solid #10b981; background-color: #f0fdf4; }</style>
</head>
<body class="bg-slate-50 text-slate-800 min-h-screen font-sans">
    <header class="bg-indigo-900 text-white shadow-md">
        <div class="max-w-7xl mx-auto px-4 py-4 flex flex-wrap justify-between items-center gap-3">
            <div class="flex items-center space-x-3">
                <i class="fa-solid fa-tower-cell text-2xl text-indigo-400"></i>
                <div>
                    <h1 class="text-xl font-bold">TelecomCompare AI + Base SQL</h1>
                    <p class="text-xs text-indigo-200">Module 1 : Extraction IA vers BDD D1 | Module 2 : Comparateur TCO & Arbitrage IA</p>
                </div>
            </div>
            <div class="space-x-2">
                <button onclick="loadQuotesFromDB()" class="bg-emerald-600 hover:bg-emerald-500 text-xs px-3 py-2 rounded-lg font-medium">
                    <i class="fa-solid fa-arrows-rotate mr-1"></i> Actualiser la BDD
                </button>
                <button onclick="clearAllDB()" class="bg-rose-600 hover:bg-rose-500 text-xs px-3 py-2 rounded-lg font-medium">
                    <i class="fa-solid fa-trash mr-1"></i> Vider la BDD
                </button>
            </div>
        </div>
    </header>

    <main class="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        <!-- GROUPE 1 : EXTRACTION IA & ENREGISTREMENT EN BASE -->
        <section class="lg:col-span-5 space-y-6">
            <div class="bg-indigo-50 p-5 rounded-xl border border-indigo-200 shadow-sm">
                <span class="text-[10px] font-bold uppercase bg-indigo-600 text-white px-2 py-0.5 rounded">Mission Groupe 1</span>
                <h2 class="text-base font-bold mt-2 text-indigo-950">
                    <i class="fa-solid fa-wand-magic-sparkles text-indigo-600 mr-1"></i> Extracteur IA de Devis Brut
                </h2>
                <p class="text-xs text-indigo-700 mb-3">Collez le texte d'un email ou PDF opérateur : l'IA extrait les données et remplit le formulaire.</p>
                <textarea id="rawQuoteText" rows="4" class="w-full rounded-lg border-indigo-300 border p-2.5 text-xs bg-white" placeholder="Exemple : Proposition Bouygues Telecom Entreprises pour une Fibre Dédiée FTTO 1 Gbps symétrique. Tarif mensuel de 340 € HT/mois (avec promotion à 200 € HT pendant les 6 premiers mois). Engagement 36 mois, Frais d'accès (FAS) de 250 €. Garantie GTR 4h 24/7 et Backup 4G automatique inclus."></textarea>
                <div class="flex gap-2 mt-2">
                    <button onclick="fillSampleText()" type="button" class="w-1/3 bg-white hover:bg-indigo-100 text-indigo-700 border border-indigo-300 text-xs font-semibold py-2 rounded-lg">
                        Exemple texte
                    </button>
                    <button onclick="extractWithAI()" id="btnExtract" type="button" class="w-2/3 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold py-2 rounded-lg shadow">
                        <i class="fa-solid fa-robot mr-1"></i> Extraire par l'IA
                    </button>
                </div>
            </div>

            <!-- Formulaire relié à la Base SQL D1 -->
            <div class="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                <h3 class="text-sm font-bold mb-3 text-slate-800 border-b pb-2">
                    <i class="fa-solid fa-database text-emerald-600 mr-1"></i> Vérification & Envoi vers la Base SQL
                </h3>
                <form id="quoteForm" class="space-y-3 text-xs">
                    <div>
                        <label class="block font-medium text-slate-700 mb-1">Opérateur & Offre *</label>
                        <input type="text" id="provider" required class="w-full rounded border-slate-300 border p-2">
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                        <div>
                            <label class="block font-medium text-slate-700 mb-1">Technologie</label>
                            <input type="text" id="tech" value="FTTO (Fibre Dédiée)" class="w-full rounded border-slate-300 border p-2">
                        </div>
                        <div>
                            <label class="block font-medium text-slate-700 mb-1">Débit</label>
                            <input type="text" id="bandwidth" placeholder="1 Gbps" class="w-full rounded border-slate-300 border p-2">
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                        <div>
                            <label class="block font-medium text-slate-700 mb-1">Abonnement €/mois *</label>
                            <input type="number" step="0.01" id="monthlyPrice" required class="w-full rounded border-slate-300 border p-2">
                        </div>
                        <div>
                            <label class="block font-medium text-slate-700 mb-1">Frais d'accès (FAS) € *</label>
                            <input type="number" step="0.01" id="setupFee" value="0" required class="w-full rounded border-slate-300 border p-2">
                        </div>
                    </div>
                    <div class="grid grid-cols-3 gap-2">
                        <div>
                            <label class="block font-medium text-slate-700 mb-1">Promo €/m</label>
                            <input type="number" step="0.01" id="promoPrice" value="0" class="w-full rounded border-slate-300 border p-2">
                        </div>
                        <div>
                            <label class="block font-medium text-slate-700 mb-1">Mois promo</label>
                            <input type="number" id="promoMonths" value="0" class="w-full rounded border-slate-300 border p-2">
                        </div>
                        <div>
                            <label class="block font-medium text-slate-700 mb-1">Engagement (m)</label>
                            <input type="number" id="commitment" value="36" required class="w-full rounded border-slate-300 border p-2">
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                        <div>
                            <label class="block font-medium text-slate-700 mb-1">SLA / GTR</label>
                            <input type="text" id="sla" value="GTR 4h" class="w-full rounded border-slate-300 border p-2">
                        </div>
                        <div>
                            <label class="block font-medium text-slate-700 mb-1">Backup 4G</label>
                            <input type="text" id="backup" value="Oui" class="w-full rounded border-slate-300 border p-2">
                        </div>
                    </div>
                    <button type="submit" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2.5 rounded-lg shadow transition">
                        <i class="fa-solid fa-cloud-arrow-up mr-1"></i> Enregistrer dans la Base de Données
                    </button>
                </form>
            </div>
        </section>

        <!-- GROUPE 2 : COMPARATEUR TCO TEMPS RÉEL & ARBITRAGE IA -->
        <section class="lg:col-span-7 space-y-6">
            <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <div class="flex justify-between items-center mb-4">
                    <div>
                        <span class="text-[10px] font-bold uppercase bg-emerald-600 text-white px-2 py-0.5 rounded">Mission Groupe 2</span>
                        <h2 class="text-base font-bold mt-1 text-slate-900">Comparateur TCO Connecté à la Base SQL</h2>
                    </div>
                    <span id="dbCount" class="text-xs bg-slate-100 text-slate-700 px-2.5 py-1 rounded-full font-semibold">0 devis en base</span>
                </div>

                <div id="quotesContainer" class="grid grid-cols-1 md:grid-cols-2 gap-4"></div>
            </div>

            <!-- Arbitrage IA Llama 3 -->
            <div class="bg-indigo-950 text-white p-6 rounded-xl shadow-md">
                <div class="flex justify-between items-center mb-3">
                    <h3 class="font-bold text-sm flex items-center text-indigo-200">
                        <i class="fa-solid fa-scale-balanced text-indigo-400 mr-2"></i> Arbitrage Expert par IA (Workers AI Llama 3.1)
                    </h3>
                    <button onclick="runAIComparison()" id="btnCompareAI" class="bg-indigo-600 hover:bg-indigo-500 text-xs px-3 py-2 rounded-lg font-semibold transition">
                        <i class="fa-solid fa-bolt mr-1"></i> Comparer les devis avec l'IA
                    </button>
                </div>
                <div id="aiComparisonResult" class="text-xs text-indigo-100 leading-relaxed whitespace-pre-line bg-indigo-900/50 p-4 rounded-lg border border-indigo-800">
                    Enregistrez au moins 2 devis dans la base de données, puis cliquez sur "Comparer les devis avec l'IA".
                </div>
            </div>
        </section>
    </main>

    <script>
        let currentQuotes = [];

        function fillSampleText() {
            const samples = [
                "Devis Orange Business Services : Liaison Fibre Dédiée FTTO 1 Gbps symétrique. Abonnement mensuel de 390 € HT sur 36 mois. Frais d'accès au service (FAS) de 450 € HT. Garantie GTR 4h 24/7 et routeur Backup 4G automatique inclus.",
                "Offre SFR Business : Fibre FTTH Pro 2 Gbps / 800 Mbps. Tarif de 110 € HT par mois avec une promotion à 75 € HT/mois pendant 6 mois. Engagement 24 mois, frais de mise en service de 150 €. GTR 8h ouvrées, sans backup 4G."
            ];
            document.getElementById('rawQuoteText').value = samples[Math.floor(Math.random() * samples.length)];
        }

        async function extractWithAI() {
            const rawText = document.getElementById('rawQuoteText').value;
            if (!rawText.trim()) return alert("Collez d'abord un texte de devis !");
            const btn = document.getElementById('btnExtract');
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Extraction IA en cours...';
            try {
                const res = await fetch('/api/extract', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ rawText })
                });
                const data = await res.json();
                if (data.success && data.extracted) {
                    const e = data.extracted;
                    document.getElementById('provider').value = e.provider || '';
                    document.getElementById('tech').value = e.tech || 'FTTO';
                    document.getElementById('bandwidth').value = e.bandwidth || '1 Gbps';
                    document.getElementById('monthlyPrice').value = e.monthlyPrice || 0;
                    document.getElementById('setupFee').value = e.setupFee || 0;
                    document.getElementById('promoPrice').value = e.promoPrice || 0;
                    document.getElementById('promoMonths').value = e.promoMonths || 0;
                    document.getElementById('commitment').value = e.commitment || 36;
                    document.getElementById('sla').value = e.sla || 'GTR 4h';
                    document.getElementById('backup').value = e.backup || 'Oui';
                } else {
                    alert("Vérifiez que le Binding 'AI' (Workers AI) est bien activé dans Settings > Bindings.");
                }
            } catch (err) {
                alert("Erreur lors de l'appel IA : " + err.message);
            }
            btn.innerHTML = '<i class="fa-solid fa-robot mr-1"></i> Extraire par l\\'IA';
        }

        function calculateTCO(q) {
            const commit = parseInt(q.commitment) || 24;
            const promoM = Math.min(parseInt(q.promoMonths) || 0, commit);
            const regM = commit - promoM;
            const promoP = (q.promoPrice && q.promoPrice > 0) ? parseFloat(q.promoPrice) : parseFloat(q.monthlyPrice);
            const total = (parseFloat(q.setupFee) || 0) + (promoM * promoP) + (regM * parseFloat(q.monthlyPrice));
            return { totalCost: total, smoothedMonthly: total / commit };
        }

        async function loadQuotesFromDB() {
            try {
                const res = await fetch('/api/quotes');
                const data = await res.json();
                currentQuotes = data.map(q => {
                    const m = calculateTCO(q);
                    return { ...q, tco: m.totalCost, smoothedMonthly: m.smoothedMonthly };
                });
                renderQuotes();
            } catch (e) {
                console.error("Base D1 non connectée ou vide", e);
            }
        }

        document.getElementById('quoteForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            const q = {
                provider: document.getElementById('provider').value,
                tech: document.getElementById('tech').value,
                bandwidth: document.getElementById('bandwidth').value,
                monthlyPrice: parseFloat(document.getElementById('monthlyPrice').value),
                setupFee: parseFloat(document.getElementById('setupFee').value) || 0,
                promoPrice: parseFloat(document.getElementById('promoPrice').value) || 0,
                promoMonths: parseInt(document.getElementById('promoMonths').value) || 0,
                commitment: parseInt(document.getElementById('commitment').value) || 36,
                sla: document.getElementById('sla').value,
                backup: document.getElementById('backup').value
            };
            await fetch('/api/quotes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(q)
            });
            this.reset();
            loadQuotesFromDB();
        });

        async function deleteQuoteDB(id) {
            await fetch('/api/quotes?id=' + id, { method: 'DELETE' });
            loadQuotesFromDB();
        }

        async function clearAllDB() {
            await fetch('/api/quotes', { method: 'DELETE' });
            loadQuotesFromDB();
        }

        async function runAIComparison() {
            if (currentQuotes.length < 2) return alert("Ajoutez au moins 2 devis dans la base pour lancer la comparaison !");
            const btn = document.getElementById('btnCompareAI');
            const out = document.getElementById('aiComparisonResult');
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Analyse en cours...';
            out.textContent = "Llama 3.1 analyse les coûts lissés (TCO) et les garanties techniques...";
            try {
                const res = await fetch('/api/compare-ai', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ quotes: currentQuotes })
                });
                const data = await res.json();
                out.textContent = data.analysis || "Aucune réponse de l'IA.";
            } catch (e) {
                out.textContent = "Erreur : vérifiez que le Binding 'AI' est bien configuré.";
            }
            btn.innerHTML = '<i class="fa-solid fa-bolt mr-1"></i> Comparer les devis avec l\\'IA';
        }

        function renderQuotes() {
            const container = document.getElementById('quotesContainer');
            document.getElementById('dbCount').textContent = currentQuotes.length + " devis en base";
            container.innerHTML = '';
            if (currentQuotes.length === 0) {
                container.innerHTML = '<div class="col-span-full p-8 text-center text-slate-400 text-xs border border-dashed rounded-lg">La base de données est vide. Utilisez l\\'extracteur IA à gauche pour ajouter un premier devis !</div>';
                return;
            }
            const sorted = [...currentQuotes].sort((a, b) => a.smoothedMonthly - b.smoothedMonthly);
            const bestId = sorted[0].id;

            currentQuotes.forEach(q => {
                const isBest = q.id === bestId && currentQuotes.length > 1;
                const card = document.createElement('div');
                card.className = 'p-4 rounded-xl border border-slate-200 flex flex-col justify-between relative ' + (isBest ? 'best-offer' : 'bg-slate-50/50');
                card.innerHTML = (isBest ? '<span class="absolute -top-2.5 right-3 bg-emerald-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">Meilleur TCO</span>' : '') +
                    '<div><div class="flex justify-between items-start"><span class="text-[10px] font-bold uppercase text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded">' + q.tech + '</span>' +
                    '<button onclick="deleteQuoteDB(' + q.id + ')" class="text-slate-400 hover:text-rose-600"><i class="fa-solid fa-xmark"></i></button></div>' +
                    '<h3 class="font-bold text-sm text-slate-900 mt-1">' + q.provider + '</h3>' +
                    '<div class="mt-2 pt-2 border-t border-slate-200"><span class="text-xl font-extrabold text-slate-900">' + q.smoothedMonthly.toFixed(2) + ' €</span> <span class="text-[11px] text-slate-500">HT/m (lissé)</span></div>' +
                    '<div class="text-[11px] text-slate-600 mt-2 space-y-1">' +
                    '<div>Facial : <strong>' + q.monthlyPrice + '€/m</strong> | FAS : <strong>' + q.setupFee + '€</strong></div>' +
                    '<div>Débit : <strong>' + q.bandwidth + '</strong> | SLA : <strong>' + q.sla + '</strong></div>' +
                    '<div>Engagement : <strong>' + q.commitment + ' mois</strong> | TCO : <strong>' + q.tco.toFixed(0) + ' € HT</strong></div>' +
                    '</div></div>';
                container.appendChild(card);
            });
        }

        loadQuotesFromDB();
    </script>
</body>
</html>`;
