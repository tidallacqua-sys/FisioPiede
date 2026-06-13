import React, { useState, useEffect, useRef } from "react";

// ─── REDE DE PROTEÇÃO: evita tela branca se alguma página (ou o app todo) der erro ──
// nivel="pagina" (padrão): protege o conteúdo da página, com "voltar e tentar de novo".
// nivel="sistema": protege o app INTEIRO (inclusive Login/Sidebar), com recarregar + suporte.
class ErrorBoundary extends React.Component {
  constructor(props){ super(props); this.state={erro:null}; }
  static getDerivedStateFromError(error){ return {erro:error}; }
  componentDidCatch(error, info){
    // Guarda o último erro para diagnóstico (admin/suporte) — nunca quebra por causa disso
    try {
      const reg = {
        quando: new Date().toISOString(),
        nivel: this.props.nivel||"pagina",
        msg: String((error&&error.message)||error||"erro desconhecido").slice(0,300),
        stack: String((error&&error.stack)||"").slice(0,800),
        tela: String((info&&info.componentStack)||"").slice(0,400),
      };
      localStorage.setItem("fp:ultimoErro", JSON.stringify(reg));
    } catch(e) {}
  }
  render(){
    if(this.state.erro){
      const sistema = this.props.nivel==="sistema";
      const msgErro = String((this.state.erro&&this.state.erro.message)||this.state.erro||"").slice(0,160);
      const zap = "https://wa.me/5519920092864?text=" + encodeURIComponent("Olá! O FisioPiede mostrou um erro na tela: \"" + msgErro + "\". Podem me ajudar?");
      return (
        <div style={{padding:40,minHeight:sistema?"100vh":"60vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",textAlign:"center",fontFamily:"sans-serif",color:"#94A3B8",background:sistema?"#06080D":"transparent"}}>
          <div style={{fontSize:44,marginBottom:14}}>🦶</div>
          <div style={{fontSize:18,fontWeight:800,color:"#E2E8F0",marginBottom:8}}>{sistema?"Ops, o FisioPiede tropeçou":"Ops, algo deu errado nesta página"}</div>
          <div style={{fontSize:13,maxWidth:440,lineHeight:1.6,marginBottom:20}}>Não se preocupe — <strong style={{color:"#E2E8F0"}}>seus dados estão salvos</strong>. {sistema?"Recarregue o sistema para continuar.":"Tente voltar e abrir novamente, ou recarregue a página."} Se o problema repetir, fale com o suporte.</div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap",justifyContent:"center"}}>
            {sistema
              ? <button onClick={()=>{ try{ window.location.reload(); }catch(e){} }} style={{padding:"10px 22px",borderRadius:10,background:"#3B82F6",color:"#fff",border:"none",fontWeight:700,fontSize:13,cursor:"pointer"}}>🔄 Recarregar o sistema</button>
              : <button onClick={()=>this.setState({erro:null})} style={{padding:"10px 22px",borderRadius:10,background:"#3B82F6",color:"#fff",border:"none",fontWeight:700,fontSize:13,cursor:"pointer"}}>Voltar e tentar de novo</button>}
            <a href={zap} target="_blank" rel="noreferrer" style={{padding:"10px 22px",borderRadius:10,background:"transparent",color:"#10B981",border:"1px solid #10B98155",fontWeight:700,fontSize:13,cursor:"pointer",textDecoration:"none"}}>💬 Falar com o suporte</a>
          </div>
          {msgErro&&<div style={{marginTop:18,fontSize:10,color:"#475569",maxWidth:460,fontFamily:"monospace"}}>Detalhe técnico: {msgErro}</div>}
        </div>
      );
    }
    return this.props.children;
  }
}

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  CONFIGURAÇÃO DO BANCO DE DADOS (Supabase) — PARA PUBLICAÇÃO              ║
// ║  Cole abaixo a URL e a chave do seu projeto Supabase.                     ║
// ║  Enquanto estiver vazio, o sistema funciona localmente (modo protótipo).  ║
// ║  Com os dados preenchidos, tudo é salvo no banco real (multi-dispositivo).║
// ╚══════════════════════════════════════════════════════════════════════════╝
const BACKEND = {
  url: "https://shlzwumixwpjxnrrnmwh.supabase.co",
  key: "sb_publishable_TpOZa39-UJWpFL3Uyjrrxg_NexIUp28",
};
const useBackend = !!(BACKEND.url && BACKEND.key);

// API do banco de dados (tabela key-value app_data)
const DB = {
  headers: () => ({ "apikey": BACKEND.key, "Authorization": "Bearer " + BACKEND.key, "Content-Type": "application/json" }),
  get: async (key) => {
    try {
      const r = await fetch(`${BACKEND.url}/rest/v1/app_data?chave=eq.${encodeURIComponent(key)}&select=valor`, { headers: DB.headers() });
      if (!r.ok) return null;
      const rows = await r.json();
      return rows && rows[0] ? rows[0].valor : null;
    } catch (e) { return null; }
  },
  set: async (key, val) => {
    try {
      await fetch(`${BACKEND.url}/rest/v1/app_data`, {
        method: "POST",
        headers: { ...DB.headers(), "Prefer": "resolution=merge-duplicates" },
        body: JSON.stringify({ chave: key, valor: val }),
      });
    } catch (e) {}
  },
};

// ─── FUNDAÇÃO FASE 2: TABELAS DE VERDADE ─────────────────────────────────────
// Clínicas, pacientes, consultas e pedidos passam a viver em tabelas reais,
// UMA LINHA POR REGISTRO (fim da sobrescrita concorrente do "bloco único").
// Estratégia ultra-segura:
//   • Leitura: prefere as tabelas; se não existirem ainda → formato antigo.
//   • Escrita: DUPLA — grava na tabela nova E no app_data (sombra de rollback).
//   • Migração: na primeira leitura com tabela vazia, importa do app_data sozinho.
const TABELAS = {
  mapa: {
    "fp:clinicas":  { tabela: "clinicas",  extras: (x)=>({ email: x.email||null, nome: x.nome||null }) },
    "fp:pacientes": { tabela: "pacientes", extras: (x)=>({ clinica_id: x.clinicaId||null, nome: (`${x.nome||""} ${x.sobrenome||""}`).trim()||null }) },
    "fp:consultas": { tabela: "consultas", extras: (x)=>({ clinica_id: x.clinicaId||null }) },
    "fp:pedidos":   { tabela: "pedidos",   extras: (x)=>({ clinica_id: x.clinicaId||null, paciente_id: x.pacienteId||null, status: x.status||null }) },
  },
  ok: {},       // descoberto em runtime: true = tabela existe; false = usar formato antigo
  migrada: {},  // garante 1 migração por sessão

  // Lê a tabela inteira → array no formato do app. undefined = tabela indisponível.
  ler: async (key) => {
    const cfg = TABELAS.mapa[key];
    if (!cfg || !useBackend || TABELAS.ok[cfg.tabela] === false) return undefined;
    try {
      const r = await fetch(`${BACKEND.url}/rest/v1/${cfg.tabela}?select=dados&order=criado_em.asc`, { headers: DB.headers() });
      if (!r.ok) { TABELAS.ok[cfg.tabela] = false; return undefined; }
      TABELAS.ok[cfg.tabela] = true;
      const rows = await r.json();
      return (rows || []).map(row => row.dados);
    } catch (e) { return undefined; }
  },

  // Grava o array como upsert linha-a-linha + remove da tabela o que saiu do array
  gravar: async (key, arr) => {
    const cfg = TABELAS.mapa[key];
    if (!cfg || !useBackend || TABELAS.ok[cfg.tabela] === false || !Array.isArray(arr)) return;
    try {
      const linhas = arr.filter(x => x && x.id !== undefined && x.id !== null)
                        .map(x => ({ id: x.id, dados: x, ...cfg.extras(x) }));
      if (linhas.length > 0) {
        const r = await fetch(`${BACKEND.url}/rest/v1/${cfg.tabela}?on_conflict=id`, {
          method: "POST",
          headers: { ...DB.headers(), "Prefer": "resolution=merge-duplicates" },
          body: JSON.stringify(linhas),
        });
        if (!r.ok) { TABELAS.ok[cfg.tabela] = false; return; }
        TABELAS.ok[cfg.tabela] = true;
      }
      // Apaga na tabela os ids que saíram do array (comparando com o último snapshot deste aparelho)
      const snapKey = "fp:tab:" + cfg.tabela;
      let antes = []; try { antes = JSON.parse(localStorage.getItem(snapKey)) || []; } catch (e) {}
      const agora = new Set(linhas.map(l => String(l.id)));
      const removidos = antes.filter(id => !agora.has(String(id)));
      if (removidos.length > 0 && TABELAS.ok[cfg.tabela] !== false) {
        const lista = removidos.map(id => encodeURIComponent('"' + String(id).replace(/"/g, "") + '"')).join(",");
        await fetch(`${BACKEND.url}/rest/v1/${cfg.tabela}?id=in.(${lista})`, { method: "DELETE", headers: DB.headers() });
      }
      try { localStorage.setItem(snapKey, JSON.stringify(linhas.map(l => l.id))); } catch (e) {}
      return true;
    } catch (e) { return false; }
  },

  // 🩺 Conta os registros de uma tabela (null = inacessível); usado pelo diagnóstico
  contar: async (tabela) => {
    try {
      const r = await fetch(`${BACKEND.url}/rest/v1/${tabela}?select=id&limit=1`, { headers: { ...DB.headers(), "Prefer": "count=exact" } });
      if (!r.ok) return { ok: false, erro: "HTTP " + r.status };
      const range = r.headers && r.headers.get ? r.headers.get("content-range") : null;
      const total = range && range.includes("/") ? parseInt(range.split("/")[1], 10) : null;
      return { ok: true, total: isNaN(total) ? null : total };
    } catch (e) { return { ok: false, erro: "sem conexão" }; }
  },
};

// ─── ARQUIVOS NA NUVEM (Supabase Storage) ────────────────────────────────────
// Sobe arquivos grandes (.stl/.obj/.jpg) para o bucket "arquivos" e devolve a
// URL pública. Se o bucket ainda não existir/estiver sem permissão, devolve
// null e o sistema usa o caminho antigo (base64 + WhatsApp) automaticamente.
const STORAGE_FP = {
  bucket: "arquivos",
  limparNome: (n) => String(n||"arquivo").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^A-Za-z0-9._-]/g,"_").slice(0,80),
  upload: async (file, pasta) => {
    if(!useBackend) return null;
    try {
      const path = `${pasta||"pedidos"}/${Date.now()}_${Math.random().toString(36).slice(2,7)}_${STORAGE_FP.limparNome(file.name)}`;
      const r = await fetch(`${BACKEND.url}/storage/v1/object/${STORAGE_FP.bucket}/${path}`, {
        method: "POST",
        headers: { "apikey": BACKEND.key, "Authorization": "Bearer "+BACKEND.key, "Content-Type": file.type||"application/octet-stream" },
        body: file,
      });
      if(!r.ok) return null;
      return `${BACKEND.url}/storage/v1/object/public/${STORAGE_FP.bucket}/${path}`;
    } catch(e){ return null; }
  },
};

// ─── ARMAZENAMENTO ────────────────────────────────────────────────────────────
// Prioridade: (1) banco Supabase se configurado; (2) window.storage (artifact);
// (3) localStorage (fallback). Assim o MESMO código funciona no protótipo e em produção.
const hasWS = typeof window !== "undefined" && window.storage && window.storage.get;
const LS = {
  read: (key) => {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch(e) { return null; }
  },
  // Leitura ASSÍNCRONA: banco real → window.storage → localStorage
  readAsync: async (key) => {
    if (useBackend) {
      // 🗃️ Fundação: chaves mapeadas leem das tabelas de verdade
      if (TABELAS.mapa[key]) {
        const t = await TABELAS.ler(key);
        if (t !== undefined) {
          if (t.length === 0 && !TABELAS.migrada[key]) {
            TABELAS.migrada[key] = true;
            // tabela vazia + app_data com dados = primeira vez → migra sozinho
            const antigo = await DB.get(key);
            if (Array.isArray(antigo) && antigo.length > 0) {
              TABELAS.gravar(key, antigo);
              try { localStorage.setItem(key, JSON.stringify(antigo)); } catch (e) {}
              return antigo;
            }
          }
          if (t.length > 0) {
            try { localStorage.setItem(key, JSON.stringify(t)); } catch (e) {}
            return t;
          }
          // tabela existe mas está vazia (e app_data também): segue fluxo normal
        }
      }
      const v = await DB.get(key); if (v !== null && v !== undefined) return v; return LS.read(key); }
    if (hasWS) {
      try { const r = await window.storage.get(key, true); return r && r.value ? JSON.parse(r.value) : null; }
      catch(e) { return null; }
    }
    return LS.read(key);
  },
  // Escrita: banco real (se configurado) + cache local
  // skipCloud=true grava só no cache local (usado antes da hidratação, para
  // evitar que uma cópia desatualizada sobrescreva dados novos no banco).
  write: (key, val, skipCloud) => {
    const s = JSON.stringify(val);
    try { localStorage.setItem(key, s); } catch(e) {}
    if (skipCloud) return;
    if (useBackend) {
      DB.set(key, val); // sombra no formato antigo (rede de segurança / rollback)
      if (TABELAS.mapa[key]) TABELAS.gravar(key, val); // 🗃️ tabela de verdade
    }
    else if (hasWS) { try { window.storage.set(key, s, true); } catch(e) {} }
  },
  // ── PEDIDOS COM ARQUIVOS: arquivos grandes (base64) vão em chaves separadas ──
  // Evita estourar o limite de 5MB/chave do window.storage ao salvar STL/OBJ/fotos.
  writePedidos: (pedidos) => {
    const leves = pedidos.map(p => {
      if (!p.arquivos) return p;
      // Salva os arquivos (com dataUrl) deste pedido numa chave própria
      const temArquivos = (p.arquivos.direito?.length || 0) + (p.arquivos.esquerdo?.length || 0) > 0;
      if (temArquivos) LS.write("fp:arq:" + p.id, p.arquivos);
      // No array principal guarda só metadata (sem dataUrl) para manter leve
      // Arquivo na nuvem (Storage) tem só uma URL pequena — mantém completo no array principal.
      // Arquivo em base64 (pesado) continua sendo separado na chave fp:arq:{id}.
      const stripSide = (arr) => (arr || []).map(a => a.nuvem ? a : ({ nome: a.nome, ext: a.ext, size: a.size }));
      return { ...p, arquivos: { direito: stripSide(p.arquivos.direito), esquerdo: stripSide(p.arquivos.esquerdo) } };
    });
    LS.write("fp:pedidos", leves);
  },
  // Lê pedidos e re-hidrata os arquivos (com dataUrl) das chaves separadas
  readPedidosAsync: async () => {
    const leves = await LS.readAsync("fp:pedidos");
    if (!leves) return null;
    const cheios = await Promise.all(leves.map(async p => {
      const temArquivos = (p.arquivos?.direito?.length || 0) + (p.arquivos?.esquerdo?.length || 0) > 0;
      if (!temArquivos) return p;
      const arq = await LS.readAsync("fp:arq:" + p.id);
      return arq ? { ...p, arquivos: arq } : p;
    }));
    return cheios;
  },
};

// ─── CONTROLE DE USOS DE IA POR CLÍNICA/MÊS ──────────────────────────────────
// Cada clínica tem um limite mensal de análises de IA conforme o plano.
const IA_USO = {
  _key: (clinicaId) => {
    const d = new Date();
    const mes = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    return `fp:iauso:${clinicaId||"admin"}:${mes}`;
  },
  // Quantos usos já foram feitos neste mês
  atual: (clinicaId) => {
    const v = LS.read(IA_USO._key(clinicaId));
    return v && typeof v.n === "number" ? v.n : 0;
  },
  // Tenta registrar mais um uso. Retorna {ok:true} ou {ok:false, ...}
  registrar: (clinicaId, limite) => {
    const usado = IA_USO.atual(clinicaId);
    if (limite !== null && limite !== undefined && usado >= limite) {
      return { ok: false, usado, limite };
    }
    LS.write(IA_USO._key(clinicaId), { n: usado + 1 });
    return { ok: true, usado: usado + 1, limite };
  },
};

// Crédito extra de IA comprado avulso (pacotes de +50). Soma ao limite do plano.
function creditoExtraIA(clinicaId){ const v = LS.read("fp:iaextra:" + clinicaId); return (v && typeof v.n === "number") ? v.n : 0; }
function addCreditoIA(clinicaId, qtd){ const at = creditoExtraIA(clinicaId); LS.write("fp:iaextra:" + clinicaId, { n: at + qtd }); }

// Verifica se a clínica pode usar a IA agora (considerando o plano/limite mensal + créditos extras).
// planoIA: "admin" = ilimitado; "Trial"/"Premium"/"Enterprise"/"Básico" = usa IA_LIMITE.
// Retorna { ok:true } ou { ok:false, msg:"..." }.
function podeUsarIA(clinicaId, planoIA) {
  if (planoIA === "admin") return { ok: true };
  const base = IA_LIMITE[planoIA] !== undefined ? IA_LIMITE[planoIA] : 0;
  const limite = base + creditoExtraIA(clinicaId);
  if (limite === 0) {
    return { ok: false, msg: "A Inteligência Artificial não está disponível no seu plano. Faça upgrade para Premium ou Enterprise." };
  }
  const r = IA_USO.registrar(clinicaId, limite);
  if (!r.ok) {
    return { ok: false, esgotou: true, msg: `Você atingiu o limite de ${limite} análises de IA. Compre um pacote extra ou aguarde a renovação no próximo mês.` };
  }
  return { ok: true, usado: r.usado, limite };
}

// Igual ao podeUsarIA, mas consome "qtd" unidades de uma vez (consulta completa = 20, imagem = 10, baropodômetro = 5).
// Só registra se houver saldo suficiente para todas as unidades.
function podeUsarIAqtd(clinicaId, planoIA, qtd) {
  if (planoIA === "admin") return { ok: true };
  const base = IA_LIMITE[planoIA] !== undefined ? IA_LIMITE[planoIA] : 0;
  const limite = base + creditoExtraIA(clinicaId);
  if (limite === 0) {
    return { ok: false, msg: "A Inteligência Artificial não está disponível no seu plano. Faça upgrade para Premium ou Enterprise." };
  }
  const usado = IA_USO.atual(clinicaId);
  if (usado + qtd > limite) {
    return { ok: false, esgotou: true, msg: `Esta ação consome ${qtd} análises e você tem apenas ${Math.max(0, limite - usado)} restante(s). Compre um pacote extra ou aguarde a renovação.` };
  }
  LS.write(IA_USO._key(clinicaId), { n: usado + qtd });
  return { ok: true, usado: usado + qtd, limite };
}

// ─── CONTROLE DE ASSINATURA (vencimento, status, bloqueio) ───────────────────
// Cada clínica tem: plano, dataAtivacao, dataVencimento, statusManual (opcional).
// O status é calculado a partir da data de vencimento, salvo se cancelada/suspensa manualmente.
const TOLERANCIA_DIAS = 5; // dias de tolerância após vencer antes de suspender

const ASSINATURA = {
  // Calcula o estado completo da assinatura de uma clínica
  calcular: (clinica) => {
    if (!clinica) return { status: "Ativa", diasRestantes: null, vencida: false, bloqueada: false };
    // Status definidos manualmente pelo admin têm prioridade
    if (clinica.statusManual === "Cancelada") return { status: "Cancelada", diasRestantes: null, vencida: true, bloqueada: true };
    if (clinica.statusManual === "Suspensa")  return { status: "Suspensa",  diasRestantes: null, vencida: true, bloqueada: true };
    // Sem vencimento definido = considerada ativa (ex.: clínicas antigas, trial)
    if (!clinica.dataVencimento) return { status: "Ativa", diasRestantes: null, vencida: false, bloqueada: false };
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const venc = new Date(clinica.dataVencimento); venc.setHours(0,0,0,0);
    const msDia = 1000*60*60*24;
    const diasRestantes = Math.round((venc.getTime() - hoje.getTime()) / msDia);
    if (diasRestantes >= 0)             return { status: "Ativa",     diasRestantes, vencida: false, bloqueada: false };
    if (diasRestantes >= -TOLERANCIA_DIAS) return { status: "Em atraso", diasRestantes, vencida: true,  bloqueada: false };
    return { status: "Suspensa", diasRestantes, vencida: true, bloqueada: true };
  },
  // Cor de cada status (para selos/badges)
  cor: (status) => ({
    "Ativa":"#10B981", "Pendente":"#F59E0B", "Em atraso":"#F97316",
    "Suspensa":"#EF4444", "Cancelada":"#64748B"
  }[status] || "#64748B"),
  // Calcula vencimento: anual (Enterprise) = +12 meses; mensal = +1 mês
  calcularVencimento: (plano, dataAtivacaoISO) => {
    const d = new Date(dataAtivacaoISO || Date.now());
    if (plano === "Enterprise") d.setMonth(d.getMonth() + 12);
    else d.setMonth(d.getMonth() + 1);
    return d.toISOString();
  },
};


// Dados pré-carregados para demonstração. Removidos automaticamente se o admin
// limpar o storage ou se o sistema for usado em produção com backend real.
const SEED_CLINICA = {
  id:1, nome:"Clínica Teste FisioPiede", email:"clinica.teste@fisiopiede.com.br",
  senha:"Clinica@123", cnpj:"99.888.777/0001-01", cpf:"111.222.333-44",
  resp:"Dr. Carlos Andrade", tel:"(11) 98888-7777", cep:"01310-100",
  rua:"Av. Paulista", numero:"1000", complemento:"Sala 201", bairro:"Bela Vista",
  cidade:"São Paulo", estado:"SP", plano:"Premium", status:"Ativa", pedidos:1,
};
const SEED_PACIENTE = {
  id:101, clinicaId:1, clinica:"Clínica Teste FisioPiede",
  nome:"João", sobrenome:"Silva Ferreira", nascimento:"1988-06-15",
  cpf:"555.444.333-22", sexo:"M", peso:"82", altura:"176", numeracao:"42",
  atividade:"Corrida", whatsapp:"(11) 97777-6666", email:"joao.silva@email.com",
  cep:"04040-010", rua:"Rua Vergueiro", numero:"500", complemento:"Apto 32",
  cidade:"São Paulo", estado:"SP", ultimaConsulta:"2026-05-22", pedidos:1,
};
const SEED_CONSULTA = {
  id:9001, clinicaId:1, paciente:"João Silva Ferreira",
  data:"2026-05-22", hora:"10:00", duracao:"60",
  tipo:"Avaliação Postural", status:"Confirmada",
  notas:"Queixa de dor plantar bilateral. Indicado avaliação baropodométrica.",
};
const SEED_PEDIDO = {
  id:"#6001", clinicaId:1, clinica:"Clínica Teste FisioPiede",
  paciente:"João Silva Ferreira", pacienteId:101,
  tipo:"Palmilha Sport", tipoPalmilha:"Inteira", tipoCalcado:"Tênis",
  flexibilidade:"Normal", cobertura:"EVA Perfurado", cor:"Preto", espessura:"4mm",
  comprimento:"27.0", larguraAntePe:"9.0", larguraCalcaneo:"7.2",
  numeracao:"42", peso:"82", altura:"176",
  obsDireito:"Suporte de arco reforçado. Leve supinação.",
  obsEsquerdo:"Padrão — sem correções adicionais.",
  obs:"Corredor. Fascite plantar inicial. Usar palmilha nos treinos diários.",
  status:"Recebido", rastreio:"", updatedAt:"22/05 09:00", data:"2026-05-22",
  log:["22/05 09:00 — Recebido"],
  arquivos:{ direito:[{nome:"pe_direito_joao.stl",ext:"STL",size:"2.3MB",dataUrl:null}],
              esquerdo:[{nome:"pe_esquerdo_joao.stl",ext:"STL",size:"2.1MB",dataUrl:null}] },
};


const PRECO = 280; // custo da palmilha junto à FisioPiede
// Preço da palmilha — apenas FATURADO (pagar no fechamento)
// Tênis/Sapato: 280  ·  Chinelo: 380
// (precoPalmilha mantém o parâmetro "antecipado" só para calcular pedidos ANTIGOS já gravados)
function precoPalmilha(produto, antecipado){
  const chinelo = /hinelo/i.test(produto||"");
  if(antecipado) return chinelo ? 350 : 250;
  return chinelo ? 380 : 280;
}
const PAGAMENTO_OPCOES = {
  "faturado":   { label: "Faturado (pagar no fechamento)", antecipado: false },
};
// Frete obrigatório por remessa
const FRETE_FP = {
  "sedex": { label: "Sedex", valor: 35 },
  "pac":   { label: "PAC",   valor: 20 },
};
const CUSTO_PRODUTO = { "Palmilha": 280, "Chinelo Postural": 380 }; // custo da clínica junto à FisioPiede (faturado)
const PRODUTOS_FP = ["Palmilha", "Chinelo Postural"];
const PIX_FP = "6c7efa4f-4bf4-4264-bf3f-32c9b439ddde"; // chave PIX (aleatória) da FisioPiede para cobranças
const C = {
  bg:"#06080D",bgCard:"#0B0E15",bgGlass:"rgba(255,255,255,0.03)",
  border:"rgba(255,255,255,0.07)",borderH:"rgba(99,179,237,0.35)",
  accent:"#3B82F6",glow:"rgba(59,130,246,0.2)",soft:"#60A5FA",
  gold:"#F59E0B",green:"#10B981",amber:"#F59E0B",
  red:"#EF4444",purple:"#8B5CF6",pink:"#EC4899",
  text:"#F1F5F9",muted:"#475569",sub:"#94A3B8",
};


// ─── MODELOS DE MARKETING POR PATOLOGIA (templates prontos) ──────────────────
// promptImg: comando pronto para o gerador de imagem. legenda: texto pronto para post.
// Tom educativo e acolhedor, sem promessa de cura (publicidade em saúde responsável).
const MKT_MODELOS = [
  { pat:"Fascite Plantar", icon:"🦶", promptImg:"close cinematográfico de um pé descalço apoiado no chão de madeira clara ao amanhecer, luz natural suave e dourada, foco na região do calcanhar e arco plantar, atmosfera de alívio e cuidado, ambiente clean", legenda:"Aquela fisgada no calcanhar nos primeiros passos do dia? ☀️ A fascite plantar é uma das queixas mais comuns de quem fica muito tempo em pé ou pratica corrida.\n\nO tratamento certo começa com uma boa avaliação biomecânica — e palmilhas posturais 3D personalizadas podem fazer toda a diferença no seu dia a dia.\n\n📍 Agende sua avaliação e dê o primeiro passo para caminhar com mais conforto.\n\n#fasciteplantar #fisioterapia #palmilhaspersonalizadas #saudedopé #biomecânica" },
  { pat:"Neuroma de Morton", icon:"⚡", promptImg:"ilustração médica moderna e elegante do antepé humano com destaque suave na região entre os dedos, estilo flat design premium, paleta de azuis e roxos, fundo claro, visual educativo e limpo", legenda:"Sente como se houvesse uma 'pedrinha' ou queimação na sola do pé, perto dos dedos? 🔥 Pode ser o Neuroma de Morton.\n\nCalçados apertados e a sobrecarga no antepé estão entre os fatores associados. A avaliação biomecânica ajuda a entender a causa e a planejar o cuidado certo, incluindo palmilhas com elementos de descarga.\n\n📍 Marque sua avaliação e cuide dos seus pés com quem entende.\n\n#neuromademorton #dornopé #fisioterapia #palmilhas3d #biomecânica" },
  { pat:"Hálux Valgo", icon:"🦴", promptImg:"fotografia profissional de pés femininos bem cuidados sobre fundo neutro claro, iluminação suave de estúdio, estética delicada e acolhedora, foco na lateral do pé, visual de campanha de saúde", legenda:"O famoso 'joanete' (hálux valgo) vai muito além da estética. 👣 Ele pode alterar toda a pisada e causar dores ao longo do tempo.\n\nCom avaliação adequada, é possível adotar estratégias para aliviar a sobrecarga e melhorar o conforto — e as palmilhas personalizadas são grandes aliadas.\n\n📍 Agende sua avaliação biomecânica.\n\n#haluxvalgo #joanete #fisioterapia #palmilhaspersonalizadas #saudedospés" },
  { pat:"Calosidades", icon:"🔆", promptImg:"close artístico e clean de pés descalços sobre toalha branca em ambiente de spa clínico, luz natural suave, atmosfera de cuidado e bem-estar, tons claros e serenos", legenda:"Calosidades não são só uma questão estética — elas indicam pontos de pressão excessiva na pisada. 🔎\n\nEntender por que elas surgem é parte de cuidar da saúde dos seus pés. Uma avaliação biomecânica revela a distribuição da pressão plantar e orienta o tratamento.\n\n📍 Venha fazer sua avaliação e entenda o que seus pés estão dizendo.\n\n#calosidades #saudedospés #fisioterapia #baropodometria #palmilhas3d" },
  { pat:"Metatarsalgia", icon:"🔥", promptImg:"ilustração premium do antepé com leve destaque luminoso na região dos metatarsos, estilo moderno flat design, azuis e tons claros, fundo limpo, aparência educativa e sofisticada", legenda:"Dor na 'sola do pé', logo abaixo dos dedos, principalmente ao caminhar? 👟 A metatarsalgia é uma sobrecarga na região do antepé.\n\nSaltos altos, calçados inadequados e alterações na pisada contribuem. A boa notícia: avaliação biomecânica + palmilhas com descarga metatarsal ajudam muito no conforto.\n\n📍 Agende sua avaliação hoje mesmo.\n\n#metatarsalgia #dornopé #fisioterapia #palmilhaspersonalizadas #biomecânica" },
  { pat:"Entorse Recidivante", icon:"🔁", promptImg:"fotografia dinâmica de um tornozelo de atleta com tênis esportivo em movimento, ambiente de academia moderna, luz natural, foco no tornozelo, estética de campanha esportiva premium", legenda:"Já 'torceu o pé' várias vezes no mesmo lugar? 🔁 A entorse recidivante acontece quando o tornozelo perde estabilidade.\n\nFortalecimento, propriocepção e suporte adequado fazem parte do cuidado — e palmilhas com estabilização podem ajudar a proteger a articulação.\n\n📍 Marque uma avaliação e cuide da estabilidade dos seus tornozelos.\n\n#entorse #tornozelo #fisioterapia #reabilitação #biomecânica" },
  { pat:"Tendinite de Calcâneo", icon:"🦵", promptImg:"close cinematográfico da parte de trás do tornozelo e tendão de aquiles de um corredor, luz dourada de fim de tarde, ambiente externo desfocado, estética esportiva e inspiradora", legenda:"Dor e rigidez na parte de trás do tornozelo, especialmente ao iniciar a atividade? 🦵 Pode ser tendinite do calcâneo (tendão de Aquiles).\n\nComum em corredores e em quem aumentou a intensidade dos treinos. A avaliação biomecânica ajuda a identificar sobrecargas e planejar o cuidado certo.\n\n📍 Agende sua avaliação e volte a se movimentar com conforto.\n\n#tendaodeaquiles #corrida #fisioterapia #biomecânica #palmilhas3d" },
  { pat:"Esporão de Calcâneo", icon:"📌", promptImg:"ilustração médica elegante e moderna do calcanhar humano com leve destaque na região inferior, estilo flat design premium, azuis e tons claros, fundo limpo e educativo", legenda:"Dor aguda no calcanhar ao pisar, como uma 'agulhada'? 📌 O esporão de calcâneo costuma estar ligado à sobrecarga e à fascite plantar.\n\nO tratamento é multifatorial — e o alívio da pressão no calcanhar com palmilhas personalizadas faz parte do cuidado.\n\n📍 Venha fazer sua avaliação biomecânica.\n\n#esporao #dornocalcanhar #fisioterapia #palmilhaspersonalizadas #saudedopé" },
  { pat:"Pés Planos", icon:"👣", promptImg:"fotografia clean de pegada de pé molhado no piso claro de uma clínica, mostrando o arco plantar, luz natural suave, composição minimalista e educativa, tons serenos", legenda:"Sabia que o formato do seu arco plantar influencia toda a sua postura? 👣 Os pés planos (arco reduzido) podem alterar a pisada e gerar sobrecargas no corpo.\n\nUma avaliação biomecânica mostra como você distribui o peso e orienta o uso de palmilhas posturais sob medida.\n\n📍 Agende sua avaliação e cuide da sua base.\n\n#pesplanos #posturologia #fisioterapia #palmilhas3d #biomecânica" },
  { pat:"Pés Cavos", icon:"⛰️", promptImg:"close artístico do perfil de um pé descalço destacando o arco plantar elevado, fundo neutro claro, iluminação lateral suave de estúdio, estética sofisticada e educativa", legenda:"Arco do pé muito elevado? ⛰️ Os pés cavos concentram a pressão no calcanhar e no antepé, o que pode gerar desconforto e instabilidade.\n\nO acompanhamento adequado e palmilhas que melhoram a distribuição da pressão trazem mais conforto ao caminhar.\n\n📍 Marque sua avaliação biomecânica.\n\n#pescavos #saudedospés #fisioterapia #palmilhaspersonalizadas #posturologia" },
  { pat:"Condromalácia", icon:"🦵", promptImg:"fotografia profissional de uma pessoa praticando alongamento de joelho em ambiente de clínica moderna e clean, luz natural, foco no joelho, estética de bem-estar e reabilitação premium", legenda:"Dor na frente do joelho ao subir escadas ou ficar muito tempo sentado? 🦵 A condromalácia patelar envolve o desgaste da cartilagem da patela.\n\nO alinhamento dos membros inferiores — que começa lá nos pés — faz parte do quadro. Avaliação biomecânica e palmilhas podem ajudar a reduzir sobrecargas.\n\n📍 Agende sua avaliação completa.\n\n#condromalacia #dornojoelho #fisioterapia #biomecânica #reabilitação" },
  { pat:"Banda Iliotibial", icon:"🏃", promptImg:"fotografia esportiva de um corredor de perfil em trilha ao ar livre ao amanhecer, foco na lateral da coxa e joelho, luz dourada natural, estética inspiradora de campanha de corrida", legenda:"Dor na lateral do joelho que aparece durante a corrida? 🏃 A síndrome da banda iliotibial é comum em corredores e ciclistas.\n\nSobrecarga, alinhamento dos membros e a pisada estão entre os fatores. Avaliação biomecânica ajuda a entender a origem e a orientar o cuidado.\n\n📍 Marque sua avaliação e corra com mais conforto.\n\n#bandailiotibial #corrida #fisioterapia #biomecânica #palmilhas3d" },
  { pat:"Tendinite Patelar", icon:"🎯", promptImg:"fotografia dinâmica de atleta saltando em quadra esportiva moderna, foco no joelho, luz natural, congelamento de movimento, estética de campanha esportiva premium e energética", legenda:"Dor logo abaixo da patela, comum em quem salta ou corre muito? 🎯 É o chamado 'joelho do saltador' (tendinite patelar).\n\nA sobrecarga repetitiva é a grande vilã. O cuidado envolve fortalecimento, ajuste de cargas e atenção à pisada e ao alinhamento.\n\n📍 Agende sua avaliação e cuide dos seus joelhos.\n\n#tendinitepatelar #joelhodosaltador #fisioterapia #esporte #biomecânica" },
  { pat:"Dedos em Garra", icon:"🖐️", promptImg:"ilustração médica moderna e delicada dos dedos do pé, estilo flat design premium, azuis e tons claros, visual educativo e limpo, fundo harmonioso", legenda:"Os dedos do pé estão se curvando para baixo, como 'garras'? 🖐️ A deformidade em garra pode causar dor, calosidades e dificuldade com calçados.\n\nO acompanhamento adequado e palmilhas com suporte correto ajudam a aliviar a pressão e melhorar o conforto.\n\n📍 Venha fazer sua avaliação biomecânica.\n\n#dedosemgarra #saudedospés #fisioterapia #palmilhaspersonalizadas #biomecânica" },
];

// ─── BIBLIOTECA DE PROTOCOLOS FISIOPIEDE ─────────────────────────────────────
const PROTOCOLOS_FP = {
  "Fascite Plantar": {
    icon: "🦶",
    cor: "#3B82F6",
    definicao: "Processo inflamatório ou degenerativo que gera dor na planta dos pés. Responsável pelo afastamento do trabalho e das atividades físicas.",
    etiologia: "Excesso de uso (overuse), degradação do colágeno e inflamação da fáscia plantar por sobrecarga.",
    prevalencia: "Mulheres de 45 a 60 anos, obesas.",
    sintomas: "Dor aos primeiros passos, piora matinal, marcha com apoio lateral, fuga do apoio do calcâneo.",
    fases: [
      { nome: "Fase Aguda (< 3 meses)", atendimentos: 6 },
      { nome: "Fase Crônica (> 3 meses)", atendimentos: 10 },
    ],
    palmilha: {
      elementos: "Barra retrocapital prolongada de PORON + Botão flexor (verificar se piora a dor na avaliação)",
      tipo: "Inteira",
      flexibilidade: "Normal",
      cobertura: "EVA Perfurado",
      espessura: "4mm",
      observacoes_direito: "Barra retrocapital prolongada de PORON. Suporte de arco. Verificar botão flexor na avaliação.",
      observacoes_esquerdo: "Barra retrocapital prolongada de PORON. Suporte de arco. Verificar botão flexor na avaliação.",
    },
    exercicios: [
      "Footcore — manutenção pelo tempo que o paciente consegue manter o arco formado",
      "Manutenção do arco plantar — flexão dos dedos sem deixar a cabeça dos metatarsos sair do solo (3x15s cada pé)",
      "Abdução dos dedos — abertura dos dedos sem extensão, manter 15s, repetir 3x",
      "Alongamento de gastrocnêmio e sóleo na parede (3x20s cada perna, diariamente)",
      "Massagem plantar com bolinha dura (tênis) — 5min/dia (se não piorar a dor)",
      "Postura de cócoras até 5 minutos (quando possível)",
      "Estiramento da fáscia plantar sentado com extensão ativa dos dedos",
    ],
    indicacoesCasa: "Alongamentos diários. Reduzir calçados de ponta apertada.",
    tratamento: "Desativação de pontos gatilhos, mobilização articular, técnicas na fáscia plantar, mobilização da dorsiflexão e do hálux, palmilhas.",
  },
  "Neuroma de Morton": {
    icon: "⚡",
    cor: "#8B5CF6",
    definicao: "Causa comum de metatarsalgia por compressão mecânica de nervos plantares. Ponto mais comum: 3º espaço digital.",
    etiologia: "Compressão e espessamento dos nervos digitais plantares. Uso de calçados de ponta fina, pé plano ou cavo.",
    prevalencia: "Mulheres 4:1, 50 anos. Bilateral em 21% dos casos.",
    sintomas: "Dor em queimação na região plantar, cabeça dos metatarsos. Piora com sapatos apertados ou salto alto.",
    fases: [{ nome: "Protocolo padrão", atendimentos: 6 }],
    palmilha: {
      elementos: "Barra infracapital de PORON + Botão flexor (cuidado com excesso de elevação na cabeça dos metas)",
      tipo: "Inteira",
      flexibilidade: "Flexível",
      cobertura: "EVA Perfurado",
      espessura: "4mm",
      observacoes_direito: "Barra infracapital de PORON posicionada abaixo das cabeças dos metatarsos. Evitar excesso de elevação.",
      observacoes_esquerdo: "Barra infracapital de PORON posicionada abaixo das cabeças dos metatarsos. Evitar excesso de elevação.",
    },
    exercicios: [
      "Footcore — manutenção do arco formado pelo tempo que o paciente consegue",
      "Manutenção do arco plantar — flexão dos dedos (3x15s cada pé)",
      "Trabalhar musculatura interóssea, evitando o ponto do neuroma",
      "Avaliação e mobilização de tíbia e tálus conforme restrição",
      "Alongamento de gastrocnêmio e sóleo (quando possível introduzir)",
    ],
    indicacoesCasa: "Alongamentos. Mudança de hábitos — evitar calçados apertados e salto alto.",
    tratamento: "Mobilização articular, técnicas na fáscia plantar, alongamentos, fortalecimento do footcore, palmilhas.",
  },
  "Hálux Valgo": {
    icon: "👣",
    cor: "#EC4899",
    definicao: "Desvio lateral do hálux acompanhado de desvio medial da cabeça do 1º metatarso.",
    etiologia: "Fatores extrínsecos: calçados inadequados de ponta fina. Fatores intrínsecos: varismo do 1º metatarso, dedo egípcio, instabilidade ligamentar, doenças reumáticas.",
    prevalencia: "Mulheres com hábito de usar calçados apertados. Proporção 15:1 (mulheres x homens).",
    sintomas: "Dor sobre a eminência medial com calçados. Estágios avançados: metatarsalgias dos raios centrais.",
    fases: [{ nome: "Protocolo padrão", atendimentos: 4 }],
    palmilha: {
      elementos: "Barra infracapital de PORON + Botão flexor (cuidado com excesso de elevação na cabeça dos metas)",
      tipo: "Inteira",
      flexibilidade: "Normal",
      cobertura: "EVA Perfurado",
      espessura: "4mm",
      observacoes_direito: "Barra infracapital de PORON. Suporte para distribuição de carga. Abdução do hálux como exercício complementar.",
      observacoes_esquerdo: "Barra infracapital de PORON. Suporte para distribuição de carga. Abdução do hálux como exercício complementar.",
    },
    exercicios: [
      "Fortalecimento do footcore com ênfase na ABDUÇÃO do hálux",
      "Footcore — manutenção pelo tempo que o paciente consegue manter o arco",
      "Manutenção do arco plantar (3x15s cada pé)",
      "Solicitar contração de abdução do hálux — 3x15s",
      "Mobilização articular do pé e tornozelo",
      "Avaliação e mobilização de tíbia e tálus",
      "Cócoras com calçado (quando possível, até 5 minutos)",
    ],
    indicacoesCasa: "Exercícios de footcore (ênfase na abdução do hálux). Mudanças de hábitos — evitar calçados de ponta fina.",
    tratamento: "Fortalecimento do footcore (principalmente abertura dos dedos), palmilhas, mudanças de hábitos.",
  },
  "Calosidades": {
    icon: "🔶",
    cor: "#F59E0B",
    definicao: "Camadas grossas e endurecidas de pele por atrito e pressão. Tipos: duro (dedos), miliar (planta), dorsal (articulações), plantar (metatarso), interdigital, neurovascular.",
    etiologia: "Aumento da produção de queratina por áreas de contato, fricção e pressão ao caminhar, saltar e calçar sapatos inadequados.",
    prevalencia: "Principalmente mulheres. Até 70% em idosos. Maior incidência: interdigital (24%), artelhos (17%), plantar (10%).",
    sintomas: "Normalmente assintomáticos. Atrito intenso: espessamento, irritação, desconforto e queimação. Em idosos: dificuldade de deambulação.",
    fases: [{ nome: "Protocolo padrão — apenas palmilhas", atendimentos: 2 }],
    palmilha: {
      elementos: "PORON no local da calosidade + Botão flexor (cuidado com excesso de elevação na cabeça dos metas)",
      tipo: "Inteira",
      flexibilidade: "Flexível",
      cobertura: "Sintético",
      espessura: "4mm",
      observacoes_direito: "PORON posicionado exatamente no local da calosidade para alívio de pressão. Verificar botão flexor na avaliação.",
      observacoes_esquerdo: "PORON posicionado exatamente no local da calosidade para alívio de pressão. Verificar botão flexor na avaliação.",
    },
    exercicios: [
      "Fortalecimento do footcore",
      "Mobilização articular",
      "Retirar calçados que aumentam o desconforto",
    ],
    indicacoesCasa: "Exercícios de footcore. Retirar calçados que aumentam o desconforto.",
    tratamento: "Fortalecimento do footcore, mobilização, palmilhas, mudanças de hábitos.",
  },
  "Metatarsalgia": {
    icon: "⚠️",
    cor: "#EF4444",
    definicao: "Toda dor que atinge a região anterior dos pés por excesso de pressão.",
    etiologia: "Calçados de ponta fina, excesso de peso, doenças neurológicas (Neuroma de Morton), artrite/artrose nos metatarsos.",
    prevalencia: "Mulheres.",
    sintomas: "Dor na bola do pé, pior após esforço ou tempo em pé. Choque, queimação, formigamento. Calosidades na sola. Dor ao apertar cabeça dos metatarsos.",
    fases: [{ nome: "A definir conforme tipo e localização", atendimentos: 4 }],
    palmilha: {
      elementos: "Palmilha específica para DOR ou MECÂNICA conforme tipo de metatarsalgia. Barra retro ou infracapital de PORON conforme avaliação.",
      tipo: "Inteira",
      flexibilidade: "Normal",
      cobertura: "EVA Perfurado",
      espessura: "4mm",
      observacoes_direito: "Palmilha específica para tipo de metatarsalgia. Avaliar necessidade de barra retro ou infracapital de PORON.",
      observacoes_esquerdo: "Palmilha específica para tipo de metatarsalgia. Avaliar necessidade de barra retro ou infracapital de PORON.",
    },
    exercicios: [
      "Mobilização articular conforme localização",
      "Fortalecimento do footcore",
      "Alongamento de panturrilha",
      "Avaliação e mobilização de tíbia e tálus",
    ],
    indicacoesCasa: "A depender da metatarsalgia apresentada.",
    tratamento: "Mobilização articular, footcore, alongamento de panturrilha e palmilhas específicas DOR/MECÂNICA.",
  },
  "Entorse Recidivante": {
    icon: "🦵",
    cor: "#06B6D4",
    definicao: "Lesão ligamentar do tornozelo por inversão forçada com tendência à recorrência. O tornozelo lateral é acometido em 85% dos casos, com lesão do ligamento talofibular anterior.",
    etiologia: "Instabilidade mecânica (frouxidão ligamentar) e/ou instabilidade funcional (déficit proprioceptivo). Calçados inadequados, superfícies irregulares e musculatura peroneal fraca.",
    prevalencia: "Atletas e praticantes de atividade física. 40% dos casos evoluem para instabilidade crônica.",
    sintomas: "Dor lateral do tornozelo, instabilidade ao pisar em terreno irregular, edema recorrente, sensação de tornozelo 'cedendo'.",
    fases: [{ nome: "Protocolo padrão", atendimentos: 6 }],
    palmilha: {
      elementos: "Cunha supinadora lateral + Estabilizador de retropé. Controle da pronação e suporte do arco longitudinal medial.",
      tipo: "Inteira",
      flexibilidade: "Rígida",
      cobertura: "EVA Perfurado",
      espessura: "5mm",
      observacoes_direito: "Cunha supinadora lateral 3-5° para estabilização do retropé. Suporte de arco longitudinal medial. Estabilizador de calcâneo.",
      observacoes_esquerdo: "Cunha supinadora lateral 3-5° para estabilização do retropé. Suporte de arco longitudinal medial. Estabilizador de calcâneo.",
    },
    exercicios: [
      "Propriocepção unipodal em superfície estável — 3x30s cada pé, olhos abertos",
      "Propriocepção unipodal em superfície instável (almofada) — 3x30s, progredir para olhos fechados",
      "Fortalecimento da musculatura peroneal — eversão com elástico 3x15 rep",
      "Fortalecimento do tibial anterior — inversão com elástico 3x15 rep",
      "Footcore — manutenção do arco e controle de pronação",
      "Mobilização da tíbia, fíbula e tálus conforme restrição",
      "Treino de marcha em terreno irregular (quando permitido)",
    ],
    indicacoesCasa: "Propriocepção diária. Fortalecer peroneais. Evitar superfícies irregulares sem calçado adequado.",
    tratamento: "Mobilização articular, fortalecimento peroneal, treino proprioceptivo progressivo, palmilhas estabilizadoras.",
  },
  "Tendinite de Calcâneo": {
    icon: "🏃",
    cor: "#F97316",
    definicao: "Processo inflamatório ou degenerativo do tendão de Aquiles, estrutura mais resistente do corpo humano, responsável pela transmissão da força do tríceps sural ao calcâneo.",
    etiologia: "Overuse (excesso de uso), aumento súbito de carga de treino, encurtamento de gastrocnêmio/sóleo, pronação excessiva, calçados inadequados sem amortecimento de calcâneo.",
    prevalencia: "Corredores e atletas (55% das lesões por corrida). Prevalente em homens de 30-50 anos.",
    sintomas: "Dor e rigidez no tendão de Aquiles, principalmente pela manhã ou após repouso. Piora no início da atividade física, melhora durante e piora após. Espessamento palpável do tendão.",
    fases: [
      { nome: "Fase aguda (< 6 semanas)", atendimentos: 6 },
      { nome: "Fase crônica (> 6 semanas)", atendimentos: 10 },
    ],
    palmilha: {
      elementos: "Elevação de calcâneo em PORON (heel lift) 6-10mm para reduzir tensão no tendão + Amortecimento de calcâneo.",
      tipo: "Inteira",
      flexibilidade: "Flexível",
      cobertura: "EVA Perfurado",
      espessura: "6mm",
      observacoes_direito: "Elevação de calcâneo em PORON 6-10mm (heel lift) para reduzir tensão no tendão de Aquiles. Amortecimento de calcâneo em gel. Suporte de arco para controle de pronação.",
      observacoes_esquerdo: "Elevação de calcâneo em PORON 6-10mm (heel lift) para reduzir tensão no tendão de Aquiles. Amortecimento de calcâneo em gel. Suporte de arco para controle de pronação.",
    },
    exercicios: [
      "Alongamento excêntrico do gastrocnêmio na parede — joelho estendido, 3x30s",
      "Alongamento excêntrico do sóleo — joelho flexionado, 3x30s",
      "Fortalecimento excêntrico do tendão — elevação de calcâneo com descida lenta (3s) — 3x15 rep",
      "Footcore — manutenção do arco plantar para controle de pronação",
      "Mobilização da tíbia, fíbula e tálus para melhorar dorsiflexão",
      "Massagem transversa profunda no tendão (fase subaguda)",
      "Progressão gradual da carga de treino — máximo 10% por semana",
    ],
    indicacoesCasa: "Alongamentos excêntricos 2x ao dia. Reduzir carga de impacto. Usar calcanheira PORON dentro do calçado.",
    tratamento: "Terapia excêntrica, mobilização articular, desativação de pontos gatilhos em gastrocnêmio/sóleo, palmilhas com heel lift.",
  },
  "Esporão de Calcâneo": {
    icon: "🦴",
    cor: "#A855F7",
    definicao: "Calcificação na região do calcâneo, frequentemente associada à fascite plantar crônica. Forma-se uma projeção óssea pela tração repetitiva da fáscia plantar.",
    etiologia: "Tração repetitiva da fáscia plantar sobre o calcâneo, sobrecarga, encurtamento da cadeia posterior, calçados inadequados e excesso de peso.",
    prevalencia: "Mulheres de 40 a 60 anos. Comum em pessoas que ficam muito tempo em pé.",
    sintomas: "Dor aguda no calcanhar, pior aos primeiros passos da manhã ou após repouso. Sensação de 'agulha' ao pisar.",
    fases: [{ nome: "Fase aguda", atendimentos: 6 }, { nome: "Fase crônica", atendimentos: 10 }],
    palmilha: {
      elementos: "Calcanheira em PORON com alívio central + Barra retrocapital. Amortecimento do calcâneo.",
      tipo: "Inteira", flexibilidade: "Flexível", cobertura: "EVA Perfurado", espessura: "5mm",
      observacoes_direito: "Calcanheira em PORON com alívio (descarga) na região do esporão. Amortecimento de calcâneo. Suporte de arco.",
      observacoes_esquerdo: "Calcanheira em PORON com alívio (descarga) na região do esporão. Amortecimento de calcâneo. Suporte de arco.",
    },
    exercicios: ["Alongamento da fáscia plantar","Massagem com bola no calcâneo","Alongamento da panturrilha","Elevação de calcanhar","Flexão dos dedos com toalha","Alongamento do sóleo"],
    indicacoesCasa: "Alongamentos diários da fáscia e panturrilha. Calcanheira de PORON no calçado. Evitar andar descalço em piso duro.",
    tratamento: "Terapia manual, alongamentos da cadeia posterior, liberação da fáscia, palmilhas com alívio de calcâneo.",
  },
  "Pés Planos": {
    icon: "🦶",
    cor: "#0EA5E9",
    definicao: "Redução ou ausência do arco longitudinal medial, fazendo com que toda a planta do pé toque o solo. Pode ser flexível ou rígido.",
    etiologia: "Frouxidão ligamentar, fraqueza da musculatura intrínseca e do tibial posterior, fatores genéticos, obesidade ou disfunção do tendão tibial posterior.",
    prevalencia: "Comum em crianças (fisiológico até 6 anos) e adultos com disfunção do tibial posterior.",
    sintomas: "Fadiga nos pés, dor no arco medial, pronação excessiva, desgaste assimétrico do calçado, dor que sobe para joelho e quadril.",
    fases: [{ nome: "Protocolo padrão", atendimentos: 6 }],
    palmilha: {
      elementos: "Suporte de arco longitudinal medial + Cunha pronadora/estabilizador de retropé para controle da pronação.",
      tipo: "Inteira", flexibilidade: "Rígida", cobertura: "EVA Perfurado", espessura: "5mm",
      observacoes_direito: "Suporte de arco longitudinal medial. Cunha medial de retropé 3-5° para controle de pronação. Estabilizador de calcâneo.",
      observacoes_esquerdo: "Suporte de arco longitudinal medial. Cunha medial de retropé 3-5° para controle de pronação. Estabilizador de calcâneo.",
    },
    exercicios: ["Elevação do arco plantar","Pegar toalha com os dedos","Elevação na ponta dos pés","Caminhada na borda lateral do pé","Alongamento da fáscia plantar","Apoio unipodal com arco ativo"],
    indicacoesCasa: "Fortalecimento diário do arco e da musculatura intrínseca. Treino de propriocepção. Calçados com bom suporte.",
    tratamento: "Fortalecimento do tibial posterior e footcore, treino proprioceptivo, palmilhas com suporte de arco.",
  },
  "Pés Cavos": {
    icon: "👣",
    cor: "#14B8A6",
    definicao: "Aumento exagerado do arco longitudinal medial, reduzindo a área de contato do pé com o solo e concentrando carga no retropé e antepé.",
    etiologia: "Causas neurológicas (Charcot-Marie-Tooth), genéticas, sequelas de trauma ou idiopáticas. Desequilíbrio entre músculos do pé.",
    prevalencia: "Menos comum que pé plano. Pode ter componente neurológico hereditário.",
    sintomas: "Sobrecarga no calcâneo e cabeça dos metatarsos, instabilidade lateral, entorses recorrentes, calosidades, dor plantar.",
    fases: [{ nome: "Protocolo padrão", atendimentos: 6 }],
    palmilha: {
      elementos: "Suporte total de contato para distribuir carga + Amortecimento em retropé e antepé. Material absorvente de impacto.",
      tipo: "Inteira", flexibilidade: "Flexível", cobertura: "EVA Perfurado", espessura: "6mm",
      observacoes_direito: "Palmilha de contato total para distribuir a pressão. Amortecimento em PORON no retropé e antepé. Preenchimento do arco.",
      observacoes_esquerdo: "Palmilha de contato total para distribuir a pressão. Amortecimento em PORON no retropé e antepé. Preenchimento do arco.",
    },
    exercicios: ["Fortalecimento do arco plantar","Pegar bolinhas com os dedos","Elevação na borda interna do pé","Caminhada na borda externa do pé","Alongamento da fáscia plantar","Equilíbrio unipodal"],
    indicacoesCasa: "Alongamento da fáscia e arco. Treino de equilíbrio e propriocepção. Calçados com amortecimento.",
    tratamento: "Mobilização, alongamento do arco rígido, treino proprioceptivo, palmilhas de contato total com amortecimento.",
  },
  "Condromalácia": {
    icon: "🦵",
    cor: "#D946EF",
    definicao: "Amolecimento e desgaste da cartilagem da patela (rótula), causando dor na região anterior do joelho. Comum em corredores e mulheres jovens.",
    etiologia: "Mau alinhamento patelar, fraqueza do quadríceps e glúteos, sobrecarga, desequilíbrio muscular, pronação excessiva do pé que altera o eixo do joelho.",
    prevalencia: "Mulheres jovens e atletas. Relacionada a desalinhamento e desequilíbrio muscular.",
    sintomas: "Dor na frente do joelho, pior ao subir/descer escadas, agachar ou ficar muito tempo sentado. Estalos e sensação de atrito.",
    fases: [{ nome: "Protocolo padrão", atendimentos: 8 }],
    palmilha: {
      elementos: "Controle de pronação (cunha medial) + Suporte de arco para corrigir o eixo do membro inferior e reduzir o estresse patelar.",
      tipo: "Inteira", flexibilidade: "Normal", cobertura: "EVA Perfurado", espessura: "4mm",
      observacoes_direito: "Cunha medial de retropé para controle de pronação. Suporte de arco longitudinal medial para alinhar o eixo do joelho.",
      observacoes_esquerdo: "Cunha medial de retropé para controle de pronação. Suporte de arco longitudinal medial para alinhar o eixo do joelho.",
    },
    exercicios: ["Contração isométrica do quadríceps","Elevação da perna estendida","Agachamento parcial na parede","Ponte de quadril","Abdução de quadril deitado","Alongamento de quadríceps"],
    indicacoesCasa: "Fortalecer quadríceps e glúteos. Evitar agachamentos profundos na dor. Alongar a cadeia anterior.",
    tratamento: "Fortalecimento de quadríceps e glúteo médio, correção do alinhamento, palmilhas para controle de pronação.",
  },
  "Banda Iliotibial": {
    icon: "🦿",
    cor: "#F43F5E",
    definicao: "Síndrome do trato iliotibial — inflamação por atrito da banda iliotibial sobre o côndilo femoral lateral, causando dor na lateral do joelho.",
    etiologia: "Overuse (corrida), fraqueza do glúteo médio, pronação excessiva, encurtamento da banda iliotibial, erros de treino.",
    prevalencia: "Corredores e ciclistas. Causa comum de dor lateral do joelho em atletas.",
    sintomas: "Dor na lateral do joelho que piora com a corrida (principalmente descidas), sensação de atrito ou queimação na face lateral.",
    fases: [{ nome: "Protocolo padrão", atendimentos: 6 }],
    palmilha: {
      elementos: "Controle de pronação (cunha medial) + Estabilizador de retropé para reduzir a rotação interna da tíbia e o estresse na banda.",
      tipo: "Inteira", flexibilidade: "Normal", cobertura: "EVA Perfurado", espessura: "4mm",
      observacoes_direito: "Cunha medial de retropé para controle de pronação. Suporte de arco para reduzir rotação tibial interna.",
      observacoes_esquerdo: "Cunha medial de retropé para controle de pronação. Suporte de arco para reduzir rotação tibial interna.",
    },
    exercicios: ["Fortalecimento do glúteo médio em pé","Abdução de quadril deitado","Ponte lateral","Alongamento da banda iliotibial em pé","Liberação com foam roller","Agachamento com mini band"],
    indicacoesCasa: "Fortalecer glúteo médio. Liberação com foam roller. Reduzir volume de corrida temporariamente.",
    tratamento: "Fortalecimento de glúteos, liberação miofascial, alongamento da banda, palmilhas para controle de pronação.",
  },
  "Tendinite Patelar": {
    icon: "🦵",
    cor: "#FB923C",
    definicao: "Inflamação ou degeneração do tendão patelar ('joelho de saltador'), que liga a patela à tíbia. Comum em esportes com saltos.",
    etiologia: "Overuse, saltos repetitivos, sobrecarga excêntrica, fraqueza de quadríceps, encurtamento da cadeia anterior, superfícies duras.",
    prevalencia: "Atletas de salto (vôlei, basquete) e corredores. Mais comum em homens jovens.",
    sintomas: "Dor na região abaixo da patela, pior ao saltar, agachar ou subir escadas. Dor no início da atividade que pode melhorar e piorar depois.",
    fases: [{ nome: "Protocolo padrão", atendimentos: 8 }],
    palmilha: {
      elementos: "Amortecimento de impacto no retropé + Controle de pronação para reduzir o estresse no tendão patelar.",
      tipo: "Inteira", flexibilidade: "Normal", cobertura: "EVA Perfurado", espessura: "5mm",
      observacoes_direito: "Amortecimento de calcâneo em PORON para absorção de impacto. Controle de pronação. Suporte de arco.",
      observacoes_esquerdo: "Amortecimento de calcâneo em PORON para absorção de impacto. Controle de pronação. Suporte de arco.",
    },
    exercicios: ["Isométrico do quadríceps na parede","Agachamento unilateral assistido","Declínio lento (excêntrico)","Elevação de perna estendida","Alongamento do quadríceps","Mobilidade do joelho"],
    indicacoesCasa: "Exercícios excêntricos diários. Reduzir saltos e impacto. Alongar quadríceps.",
    tratamento: "Terapia excêntrica progressiva, fortalecimento de quadríceps, palmilhas com amortecimento de impacto.",
  },
  "Dedos em Garra": {
    icon: "🦀",
    cor: "#10B981",
    definicao: "Deformidade dos dedos com extensão metatarsofalangiana e flexão dos dedos. Pode ser rígida ou flexível.",
    etiologia: "Calçados de ponta fina, excesso de peso, doenças neurológicas, artrite/artrose, traumas (fraturas/luxações), AVC, diabetes, gota, artrose, causas biomecânicas ou idiopáticas.",
    prevalencia: "Mulheres 3:1. Atinge ~20% da população.",
    sintomas: "Dor e dificuldade com sapatos. Calosidades nas áreas de atrito, rigidez, perda de força e mobilidade, inchaço e vermelhidão.",
    fases: [{ nome: "Protocolo padrão", atendimentos: 4 }],
    palmilha: {
      elementos: "Barra subdigital + Botão flexor",
      tipo: "Inteira",
      flexibilidade: "Flexível",
      cobertura: "EVA Perfurado",
      espessura: "4mm",
      observacoes_direito: "Barra subdigital para apoio e correção dos dedos. Botão flexor para estímulo da musculatura intrínseca.",
      observacoes_esquerdo: "Barra subdigital para apoio e correção dos dedos. Botão flexor para estímulo da musculatura intrínseca.",
    },
    exercicios: [
      "Footcore — manutenção do arco formado",
      "Manutenção do arco plantar — flexão dos dedos (3x15s)",
      "Abdução dos dedos — abrir sem estender (3x15s)",
      "Alongamento de gastrocnêmio e sóleo na parede (3x20s, diariamente)",
      "Verificar e substituir calçados mais apertados (tamanho menor)",
      "Massagem com bola de tênis na região plantar",
      "Cócoras com calçado quando possível (até 5 minutos)",
    ],
    indicacoesCasa: "Exercícios de footcore. Massagem plantar. Substituir calçados apertados.",
    tratamento: "Relaxamento/fortalecimento do footcore, palmilhas, mobilização articular.",
  },
};


// ─── EXERCÍCIOS DETALHADOS POR PATOLOGIA (extraídos dos infográficos FisioPiede) ──
const EXERCICIOS_PACIENTE = {
  "Fascite Plantar": [
    {n:"Alongamento da Fáscia Plantar",t:"30 seg",s:"3 séries",como:"Puxe os dedos do pé para trás com a mão, alongando a região da planta do pé.",obj:"Aliviar a tensão da fáscia plantar."},
    {n:"Rolamento com Bola",t:"2 min",s:"2 séries",como:"Role a planta do pé sobre a bola, fazendo movimentos lentos para massagear a região.",obj:"Reduzir dor e tensão na fáscia plantar."},
    {n:"Alongamento da Panturrilha",t:"30 seg",s:"3 séries",como:"Apoie as mãos na parede e mantenha uma perna à frente e outra atrás, alongando a panturrilha da perna de trás.",obj:"Reduzir tensão na cadeia posterior que impacta a fáscia plantar."},
    {n:"Elevação de Panturrilha",t:"15 rep",s:"3 séries",como:"Suba na ponta dos pés e desça lentamente, fortalecendo a panturrilha e melhorando o suporte do pé.",obj:"Fortalecer panturrilhas e melhorar o suporte da fáscia plantar."},
    {n:"Flexão de Dedos com Toalha",t:"15 rep",s:"3 séries",como:"Coloque uma toalha no chão e puxe com os dedos do pé em direção a você, repetindo o movimento.",obj:"Fortalecer os músculos intrínsecos do pé."},
    {n:"Alongamento do Sóleo",t:"30 seg",s:"3 séries",como:"Em posição de avanço, dobre levemente o joelho da perna da frente e mantenha a outra estendida, alongando o músculo sóleo.",obj:"Melhorar a mobilidade e reduzir sobrecarga na fáscia plantar."},
  ],
  "Esporão de Calcâneo": [
    {n:"Alongamento da Fáscia Plantar",t:"30 seg",s:"3 séries",como:"Sente-se e puxe os dedos do pé para trás com a mão, alongando a sola do pé.",obj:"Alongar a fáscia plantar e reduzir a tensão."},
    {n:"Massagem com Bola",t:"2 min",s:"2 séries",como:"Role a planta do pé sobre a bola de tênis ou massageadora, fazendo movimentos lentos do calcanhar até os dedos.",obj:"Reduzir a dor e a tensão na fáscia plantar."},
    {n:"Alongamento da Panturrilha",t:"30 seg",s:"3 séries",como:"Apoie as mãos na parede, coloque uma perna à frente e a outra atrás, mantendo o calcanhar traseiro no chão e alongando a panturrilha.",obj:"Melhorar a flexibilidade da panturrilha e reduzir a tensão sobre o calcanhar."},
    {n:"Elevação de Calcanhar",t:"15 rep",s:"3 séries",como:"Fique em pé e eleve os calcanhares, subindo na ponta dos pés e descendo lentamente.",obj:"Fortalecer a panturrilha e melhorar o suporte do pé."},
    {n:"Flexão dos Dedos com Toalha",t:"15 rep",s:"3 séries",como:"Coloque uma toalha no chão e puxe com os dedos do pé em direção a você.",obj:"Fortalecer os músculos intrínsecos do pé."},
    {n:"Alongamento do Sóleo",t:"30 seg",s:"3 séries",como:"Em posição de avanço, dobre levemente o joelho da perna da frente e mantenha a outra estendida, alongando o músculo sóleo.",obj:"Melhorar a flexibilidade do sóleo e reduzir a carga sobre o calcanhar."},
  ],
  "Metatarsalgia": [
    {n:"Massagem com Bolinha",t:"2 min",s:"2 séries",como:"Role a planta do pé sobre a bolinha, travando levemente nas áreas mais sensíveis dos metatarsos. Faça movimentos lentos e controlados.",obj:"Reduzir a dor, soltar a fáscia plantar e melhorar a circulação na região dos metatarsos."},
    {n:"Elevação dos Dedos com Toalha",t:"15 rep",s:"3 séries",como:"Coloque uma toalha no chão e use os dedos dos pés para puxá-la em sua direção.",obj:"Fortalecer os músculos intrínsecos do pé e melhorar o controle dos dedos."},
    {n:"Abdução dos Dedos com Elástico",t:"15 rep",s:"3 séries",como:"Coloque um elástico ao redor dos dedos dos pés e afaste os dedos uns dos outros, contraindo-os levemente. Volte e repita.",obj:"Fortalecer os músculos intrínsecos e melhorar a distribuição das cargas nos metatarsos."},
    {n:"Flexão dos Dedos com Elástico",t:"15 rep",s:"3 séries",como:"Prenda o elástico em um ponto fixo e coloque-o na ponta dos dedos. Puxe os dedos em direção ao seu corpo, fazendo flexão.",obj:"Fortalecer a musculatura flexora dos dedos e reduzir a sobrecarga nos metatarsos."},
    {n:"Alongamento da Fáscia Plantar",t:"30 seg",s:"3 séries",como:"Puxe os dedos do pé para trás com a mão, alongando a planta do pé e a fáscia plantar. Mantenha a posição.",obj:"Alongar a fáscia plantar e os músculos da região anterior do pé."},
    {n:"Apoio sobre os Metatarsos",t:"30 seg",s:"3 séries",como:"Fique em pé apoiando o peso apenas na região dos metatarsos (na parte da frente do pé), mantendo o calcanhar elevado. Mantenha o equilíbrio.",obj:"Fortalecer a musculatura da frente do pé e melhorar o equilíbrio e a estabilidade."},
  ],
  "Pés Planos": [
    {n:"Elevação do Arco Plantar",t:"15 rep",s:"3 séries",como:"Fique em pé e eleve o arco do pé, contraindo os músculos da planta do pé, sem dobrar os dedos. Mantenha e desça lentamente.",obj:"Fortalecer os músculos intrínsecos do pé e melhorar o arco plantar."},
    {n:"Pegar Toalha com os Dedos",t:"15 rep",s:"3 séries",como:"Sente-se e, com os dedos do pé, puxe a toalha em sua direção. Repita o movimento.",obj:"Fortalecer os músculos intrínsecos do pé e melhorar o controle dos dedos."},
    {n:"Elevação na Ponta dos Pés",t:"15 rep",s:"3 séries",como:"Fique em pé e eleve-se na ponta dos pés, mantendo o arco plantar ativo. Desça lentamente.",obj:"Fortalecer panturrilhas e músculos do arco plantar, melhorando a estabilidade."},
    {n:"Caminhada na Borda Lateral do Pé",t:"30 seg",s:"3 séries",como:"Caminhe apoiando apenas a borda externa do pé, do calcanhar até os dedos. Volte e repita.",obj:"Melhorar o controle muscular e o alinhamento do pé."},
    {n:"Alongamento da Fáscia Plantar",t:"30 seg",s:"3 séries",como:"Sente-se e puxe os dedos do pé em direção ao corpo, alongando a sola do pé. Mantenha a posição.",obj:"Aliviar a tensão da fáscia plantar e melhorar a flexibilidade."},
    {n:"Apoio Unipodal com Arco Ativo",t:"30 seg",s:"3 séries",como:"Fique em um pé só, ativando o arco plantar e mantendo o joelho levemente flexionado.",obj:"Melhorar equilíbrio, propriocepção e fortalecer a musculatura do pé."},
  ],
  "Pés Cavos": [
    {n:"Fortalecimento do Arco Plantar",t:"30 seg",s:"3 séries",como:"Sente-se e, com os dedos do pé, puxe uma toalha em sua direção, contraindo o arco plantar. Repita o movimento.",obj:"Fortalecer os músculos intrínsecos do pé e melhorar o arco plantar."},
    {n:"Pegar Bolinhas com os Dedos",t:"2 min",s:"3 séries",como:"Use os dedos do pé para pegar bolinhas do chão e colocá-las em um recipiente. Faça com calma e controle.",obj:"Aumentar força, controle e coordenação dos dedos e do arco plantar."},
    {n:"Elevação na Borda Interna do Pé",t:"15 rep",s:"3 séries",como:"Fique em pé e eleve-se apoiando mais na borda interna do pé (hálux), fortalecendo o arco medial. Desça lentamente.",obj:"Fortalecer o arco medial e melhorar o alinhamento e estabilidade do pé."},
    {n:"Caminhada na Borda Externa do Pé",t:"30 seg",s:"3 séries",como:"Caminhe apoiando-se na borda externa do pé (lado do mindinho), mantendo o controle e o equilíbrio. Volte e repita.",obj:"Fortalecer músculos da borda externa do pé e melhorar o equilíbrio muscular."},
    {n:"Alongamento da Fáscia Plantar",t:"30 seg",s:"3 séries",como:"Puxe os dedos do pé para trás com a mão, alongando a planta do pé e a fáscia plantar. Mantenha a posição.",obj:"Alongar a fáscia plantar e reduzir a rigidez do arco."},
    {n:"Equilíbrio Unipodal",t:"30 seg",s:"3 séries",como:"Fique em um pé só, mantendo o arco ativo e o equilíbrio. Progrida fechando os olhos ou usando uma superfície instável.",obj:"Melhorar o equilíbrio, a propriocepção e o controle neuromuscular do pé."},
  ],
  "Condromalácia": [
    {n:"Contração Isométrica do Quadríceps",t:"10 seg",s:"3 séries",como:"Com a perna estendida, contraia os músculos da coxa empurrando o joelho para baixo contra o colchão. Mantenha a contração e relaxe.",obj:"Ativar o quadríceps sem sobrecarregar a articulação."},
    {n:"Elevação da Perna Estendida",t:"15 rep",s:"3 séries",como:"Deite-se, uma perna dobrada e a outra estendida. Eleve a perna estendida mantendo o joelho reto e retorne lentamente.",obj:"Fortalecer o quadríceps e estabilizar a patela."},
    {n:"Agachamento Parcial na Parede",t:"30 seg",s:"3 séries",como:"Apoie as costas na parede e deslize até a posição de agachamento parcial (aprox. 45° de flexão de joelhos). Mantenha a posição e retorne.",obj:"Fortalecer quadríceps e glúteos com menor sobrecarga articular."},
    {n:"Ponte de Quadril",t:"15 rep",s:"3 séries",como:"Deite-se com os joelhos flexionados e pés no chão. Eleve o quadril contraindo glúteos e posteriores de coxa. Desça lentamente.",obj:"Fortalecer glúteos e posteriores, ajudando no alinhamento do joelho."},
    {n:"Abdução de Quadril Deitado",t:"15 rep",s:"3 séries",como:"Deite-se de lado, mantenha uma perna dobrada para apoio e eleve a outra perna estendida. Retorne lentamente.",obj:"Fortalecer o glúteo médio e melhorar a estabilidade do joelho."},
    {n:"Alongamento de Quadríceps",t:"30 seg",s:"3 séries",como:"Em pé, segure o tornozelo e puxe o calcanhar em direção ao glúteo, mantendo os joelhos juntos e o quadril alinhado.",obj:"Alongar o quadríceps e reduzir a tensão na articulação do joelho."},
  ],
  "Banda Iliotibial": [
    {n:"Fortalecimento do Glúteo Médio em Pé",t:"30 seg",s:"3 séries",como:"Fique em pé e eleve uma perna lateralmente, mantendo o tronco alinhado e os pés apontados para frente. Retorne lentamente.",obj:"Fortalecer o glúteo médio e estabilizar o quadril e joelho."},
    {n:"Abdução de Quadril Deitado",t:"15-20 rep",s:"3 séries",como:"Deite-se de lado e eleve a perna de cima, mantendo os pés alinhados e o tronco estável. Retorne lentamente.",obj:"Fortalecer o glúteo médio e reduzir a tensão na banda iliotibial."},
    {n:"Ponte Lateral",t:"30-45 seg",s:"3 séries",como:"Apoie o antebraço e os pés no chão, eleve o quadril formando uma linha reta do ombro aos pés. Mantenha e retorne lentamente.",obj:"Fortalecer o core, glúteos e estabilizadores do quadril."},
    {n:"Alongamento da Banda Iliotibial em Pé",t:"30 seg",s:"3 séries",como:"Cruze uma perna por trás da outra e incline o tronco para o lado oposto, alongando a lateral do quadril e da coxa.",obj:"Alongar a banda iliotibial e reduzir tensões na lateral da coxa."},
    {n:"Liberação da Banda Iliotibial com Foam Roller",t:"1-2 min",s:"1-2 séries",como:"Deite-se de lado e apoie a lateral da coxa sobre o rolo. Deslize lentamente do quadril até o joelho, controlando a pressão.",obj:"Reduzir tensões e aderências na banda iliotibial."},
    {n:"Agachamento com Mini Band",t:"15-20 rep",s:"3 séries",como:"Coloque o elástico acima dos joelhos. Agache mantendo os joelhos alinhados com os pés e sem deixar o elástico ceder. Retorne lentamente.",obj:"Fortalecer glúteos e estabilizadores do quadril, reduzindo o estresse na banda iliotibial."},
  ],
  "Tendinite Patelar": [
    {n:"Isométrico do Quadríceps na Parede",t:"45 seg",s:"3 séries",como:"Apoie as costas na parede com os joelhos levemente flexionados (aprox. 60°). Contraia o quadríceps e mantenha a posição.",obj:"Fortalecer o quadríceps sem sobrecarga no tendão patelar."},
    {n:"Agachamento Unilateral Assistido",t:"12-15 rep",s:"3 séries",como:"Com apoio, faça um agachamento em uma perna só, descendo até onde não houver dor. Retorne lentamente.",obj:"Fortalecer o tendão patelar com controle e estabilidade."},
    {n:"Declínio Lento (Excêntrico)",t:"15 rep",s:"3 séries",como:"Suba com as duas pernas e desça lentamente com uma perna, controlando o movimento (3 a 5 segundos).",obj:"Estimular o tendão patelar com carga excêntrica controlada."},
    {n:"Elevação de Perna Estendida",t:"15-20 rep",s:"3 séries",como:"Com uma perna estendida, eleve mantendo o joelho reto e contraia o quadríceps. Desça lentamente.",obj:"Fortalecer o quadríceps com baixo impacto no joelho."},
    {n:"Alongamento do Quadríceps",t:"30 seg",s:"3 séries",como:"Segure o tornozelo e puxe o calcanhar em direção ao glúteo, mantendo os joelhos alinhados. Troque de perna.",obj:"Melhorar a flexibilidade e reduzir a tensão muscular."},
    {n:"Mobilidade do Joelho",t:"45 seg",s:"3 séries",como:"Em posição de meia ajoelhada, deslize o joelho à frente mantendo o calcanhar no chão. Retorne lentamente.",obj:"Melhorar a mobilidade e a função do joelho."},
  ],
};


// ══════════════════════════════════════════════════════════════════════════════
// FISIOPIEDE ACADEMY — Universidade Corporativa Digital
// ══════════════════════════════════════════════════════════════════════════════
const ACADEMY_NIVEIS = [
  { nome:"Iniciante",    min:0,    cor:"#94A3B8", icon:"🌱" },
  { nome:"Practitioner", min:150,  cor:"#22D3EE", icon:"⚡" },
  { nome:"Specialist",   min:400,  cor:"#3B82F6", icon:"🎯" },
  { nome:"Expert",       min:800,  cor:"#8B5CF6", icon:"💎" },
  { nome:"Master",       min:1400, cor:"#F59E0B", icon:"👑" },
  { nome:"Elite",        min:2200, cor:"#EF4444", icon:"🏆" },
];
const nivelDe = (xp) => { let n = ACADEMY_NIVEIS[0]; for (const lv of ACADEMY_NIVEIS) if (xp >= lv.min) n = lv; return n; };
const proxNivel = (xp) => ACADEMY_NIVEIS.find(lv => lv.min > xp) || null;

// Cursos com módulos e aulas (conteúdo real derivado das apostilas FisioPiede)
const ACADEMY_CURSOS = [
  {
    id:"baropodometria", titulo:"Baropodometria Clínica Premium", trilha:"Baropodometria Clínica",
    nivel:"Intermediário", cor:"#3B82F6", icon:"👣", obrigatorio:true, horas:8,
    desc:"Formação completa em baropodometria: dos fundamentos dos sensores à interpretação clínica e aplicação na prescrição de palmilhas posturais 3D.",
    modulos:[
      { titulo:"Fundamentos da Baropodometria", aulas:[
        { t:"História e conceitos da baropodometria", txt:"A baropodometria é o estudo das pressões plantares durante a postura estática e dinâmica. Surgiu da necessidade de quantificar objetivamente a distribuição de carga nos pés. Mede a interface entre o pé e o solo, fornecendo mapas de pressão que revelam sobrecargas, assimetrias e compensações posturais." },
        { t:"Funcionamento dos sensores", txt:"As plataformas usam sensores resistivos ou capacitivos que convertem a pressão mecânica em sinal elétrico. A resolução (sensores/cm²) determina a precisão do mapa. Sensores capacitivos oferecem maior durabilidade e linearidade; resistivos são mais acessíveis." },
        { t:"Tipos de plataformas e aplicações", txt:"Existem plataformas estáticas (avaliação em pé parado), dinâmicas (análise da marcha) e palmilhas instrumentadas (medição dentro do calçado). A escolha depende do objetivo clínico: triagem postural, análise de marcha ou validação de órtese." },
      ]},
      { titulo:"Interpretação dos Exames", aulas:[
        { t:"Mapas de pressão e centro de pressão (CoP)", txt:"O mapa de pressão usa escala de cores (azul=baixa, vermelho=alta pressão). O centro de pressão (CoP) é o ponto médio de aplicação das forças; seu deslocamento (estatocinesiograma) indica controle postural. Oscilações amplas sugerem déficit proprioceptivo." },
        { t:"Distribuição de cargas e picos de pressão", txt:"Em condições normais, ~60% da carga fica no retropé e ~40% no antepé. Picos localizados indicam sobrecarga (ex: cabeça do 2º metatarso na metatarsalgia). A análise guia onde posicionar descargas e elementos na palmilha." },
        { t:"Simetria corporal e assimetrias", txt:"Compara-se a carga entre os pés direito e esquerdo. Assimetrias maiores que 10% merecem investigação. Podem indicar dismetria de membros, escoliose, ou compensações de cadeias musculares." },
      ]},
      { titulo:"Biomecânica da Marcha", aulas:[
        { t:"Fases e ciclo da marcha", txt:"O ciclo da marcha vai do contato inicial de um pé ao próximo contato do mesmo pé. Divide-se em fase de apoio (~60%) e balanço (~40%). A fase de apoio inclui contato do calcâneo, médio apoio e propulsão (push-off)." },
        { t:"Compensações e cadeias musculares", txt:"Disfunções geram compensações ao longo das cadeias miofasciais. Um pé pronado pode causar rotação interna da tíbia, valgo de joelho e báscula pélvica. A baropodometria dinâmica revela essas compensações na fase de apoio." },
      ]},
      { titulo:"Baropodometria Aplicada às Palmilhas", aulas:[
        { t:"Estratégias de correção e descargas", txt:"Com base nos picos de pressão, define-se onde descarregar (aliviar) e onde sustentar. Descargas em PORON na área de dor; barras retro ou infracapitais para redistribuir carga metatarsal; suportes de arco para controlar pronação." },
        { t:"Seleção de elementos e materiais", txt:"A escolha do material (EVA densidades, PORON, gel) depende do objetivo: amortecer, sustentar ou corrigir. Materiais mais densos corrigem; mais macios amortecem. A baropodometria de controle valida se a palmilha redistribuiu a carga." },
      ]},
      { titulo:"Casos Clínicos Reais", aulas:[
        { t:"Raciocínio clínico aplicado", txt:"Estudo de caso: paciente com dor plantar matinal e pico de pressão no calcâneo medial. Interpretação: fascite plantar com sobrecarga de retropé. Conduta: barra retrocapital de PORON + alívio de calcâneo + alongamentos da cadeia posterior." },
      ]},
    ],
    prova:[
      { q:"Em condições normais, qual a distribuição aproximada de carga entre retropé e antepé?", opts:["60% retropé / 40% antepé","50% / 50%","30% retropé / 70% antepé","80% antepé / 20% retropé"], correta:0 },
      { q:"O que o centro de pressão (CoP) avalia?", opts:["A temperatura do pé","O controle postural e oscilação corporal","O comprimento do pé","A cor da pele plantar"], correta:1 },
      { q:"Uma assimetria de carga entre os pés é considerada relevante a partir de quanto?", opts:["1%","5%","10%","50%"], correta:2 },
      { q:"Qual elemento é indicado para aliviar pressão numa área de dor localizada?", opts:["Barra metatarsal rígida","Descarga em PORON no local","Cunha lateral","Salto alto"], correta:1 },
    ],
  },
  {
    id:"posturologia", titulo:"Posturologia Clínica Completa", trilha:"Avaliação Postural",
    nivel:"Avançado", cor:"#8B5CF6", icon:"🧍", obrigatorio:true, horas:16,
    desc:"Formação completa em Posturologia Osteopática: do sistema tônico postural às entradas podal, ocular e dento-oclusal, diafragma, cadeias musculares e aplicação clínica na prescrição de palmilhas posturais 3D. Base científica para avaliação global do paciente.",
    modulos:[
      { titulo:"Fundamentos da Posturologia", aulas:[
        { t:"História e nascimento da Posturologia", txt:"A posturologia clínica surgiu como a organização de conhecimentos dispersos, validando uma sintomatologia mal conhecida (Gagey). É um método de avaliação GLOBAL do corpo cujo objetivo é evitar desequilíbrios crônicos causados por desajustes posturais. A preocupação com a postura humana surgiu primeiro como necessidade artística (Charles Bell, 1837, perguntou como o homem mantém a postura ereta) e evoluiu para a neurociência do equilíbrio. Em 1984 foi criada a Associação de Posturologia, consolidando o campo." },
        { t:"O que é postura", txt:"Segundo Enoka (2000), a postura é uma resposta neuromecânica relacionada à manutenção do equilíbrio. Um sistema está em equilíbrio mecânico quando a somatória das forças que atuam sobre ele é igual a zero — mas só tem estabilidade se, após uma perturbação, retorna à posição de equilíbrio. Para Magee, é o composto das posições das diferentes articulações do corpo num dado momento. A postura correta exige o mínimo de esforço muscular para se manter." },
        { t:"O Sistema Tônico Postural (STP)", txt:"O STP é o sistema que mantém o corpo ereto contra a gravidade e organiza o tônus muscular. Ele integra informações de múltiplos captores sensoriais: pés (entrada podal), olhos (entrada ocular), oclusão dentária, sistema vestibular, pele e articulações. Esses dados são processados pelos centros superiores, que selecionam as estratégias de equilíbrio. Quando uma entrada está disfuncional, o sistema gera compensações que se propagam por todo o corpo." },
      ]},
      { titulo:"O Diafragma e o Tendão Central", aulas:[
        { t:"Anatomia e papel postural do diafragma", txt:"O diafragma é uma lâmina musculotendínea larga e fina, em forma de cúpula, que separa a cavidade torácica da abdominal. O nome vem do grego dia (através) + phragma (feixe). Além da função respiratória, tem papel postural central: conecta-se às vértebras lombares pelos pilares, às costelas e ao esterno, influenciando toda a cadeia central do corpo. Tensões diafragmáticas alteram o tônus postural global." },
        { t:"Tendão central e cadeias", txt:"O tendão central (frênico) é o ponto de ancoragem do diafragma e se conecta, por continuidade fascial, ao pericárdio e às estruturas cervicais. Essa continuidade explica por que disfunções respiratórias ou viscerais repercutem na postura e vice-versa. Na abordagem osteopática, a liberação diafragmática faz parte do tratamento postural global." },
      ]},
      { titulo:"Cicatrizes e Postura", aulas:[
        { t:"O impacto postural das cicatrizes", txt:"Cicatrizes podem se comportar como 'espinhos irritativos' no sistema fascial, alterando a tensão das cadeias miofasciais e mantendo desequilíbrios posturais. Uma cicatriz aderente — cirúrgica ou traumática — pode ser a causa oculta de uma compensação postural que não responde ao tratamento podal isolado. Por isso a anamnese deve investigar cirurgias e traumas prévios." },
        { t:"Avaliação e tratamento de cicatrizes", txt:"Testa-se a relevância postural de uma cicatriz observando se sua estimulação/inibição altera os testes posturais. Quando relevante, o tratamento manual da cicatriz (liberação fascial) pode normalizar o tônus. Esse é um diferencial da abordagem osteopática integrada à posturologia." },
      ]},
      { titulo:"Entrada Ocular", aulas:[
        { t:"O olho como captor postural", txt:"A entrada ocular é uma das principais vias do STP. A musculatura ocular extrínseca e a convergência informam o cérebro sobre a posição da cabeça e do corpo no espaço. Heteroforias e disfunções de convergência podem gerar compensações posturais cervicais e globais. Por isso a avaliação postural inclui testes oculares." },
        { t:"Testes e relevância clínica", txt:"Testa-se a entrada ocular cobrindo os olhos ou usando testes de convergência e observando mudanças no tônus e nos testes posturais. Quando a entrada ocular é a dominante do desequilíbrio, o paciente deve ser encaminhado para avaliação oftalmológica/ortóptica especializada, em paralelo ao trabalho podal." },
      ]},
      { titulo:"Entrada Dento-Oclusal", aulas:[
        { t:"Oclusão e postura (relação crânio-mandibular)", txt:"A oclusão dentária e a articulação temporomandibular (ATM) influenciam o tônus postural por vias neurológicas (trigêmeo) e biomecânicas. Má oclusão, bruxismo e disfunções de ATM podem manter desequilíbrios posturais. A entrada dento-oclusal é frequentemente subestimada, mas pode ser determinante em casos resistentes." },
        { t:"Avaliação integrada com a odontologia", txt:"Testa-se colocando algodão entre os dentes (desprogramação oclusal) e reavaliando a postura. Se houver mudança significativa, indica-se trabalho conjunto com dentista/ortodontista. A posturologia atua de forma multidisciplinar, integrando podal, ocular e oclusal." },
      ]},
      { titulo:"Entrada Podal (o foco da palmilha)", aulas:[
        { t:"O pé como captor e efetor", txt:"A entrada podal é uma das principais vias posturais — responsável pela propriocepção do corpo em relação ao solo. O pé é um conjunto proprioceptivo e exteroceptivo excepcional, que recebe informações dos músculos, articulações e pele. Tem duas funções: via de ENTRADA de informações (capta) e via de SAÍDA (efetua). O homem é um 'pêndulo invertido' que se equilibra sobre o triângulo de apoio dos pés." },
        { t:"Pé causativo vs pé adaptativo", txt:"Distinção clínica fundamental: o pé CAUSATIVO é a origem do desequilíbrio postural (a disfunção começa no pé); o pé ADAPTATIVO apenas se ajusta a um problema que vem de cima (ocular, oclusal, cicatriz). A palmilha postural é mais eficaz no pé causativo. Identificar essa diferença evita prescrições equivocadas." },
        { t:"Reflexo cutâneo-podal", txt:"Estímulos sutis na planta do pé alteram o tônus muscular à distância: uma estimulação ao nível dos primeiros cuneiformes aumenta o tônus dos rotadores laterais do quadril homolateral; ao nível do estiloide do 5º metatarso, aumenta os rotadores mediais. É a base científica das palmilhas posturais com micro-relevos (elementos), que modificam as cadeias proprioceptivas ascendentes." },
      ]},
      { titulo:"Baropodometria e Marcha", aulas:[
        { t:"Baropodometria — conceito e leitura", txt:"Termo descrito por Piero Galazzo (1986): podo (pé) + baro (pressão) + metron (medida). É o estudo da distribuição das pressões plantares, estática e dinâmica, por plataforma eletrônica de sensores. Permite compreender a biomecânica do pé e aplicá-la nos processos patológicos. Avalia distribuição de carga, picos de pressão, centro de pressão (CoP) e simetria." },
        { t:"A marcha humana", txt:"A marcha é a locomoção bípede que integra os sistemas neuromotor, sensorial e musculoesquelético com mínimo gasto energético. Conceitos-chave: cadência (passos por unidade de tempo), passo (do contato de um pé ao contato do outro) e passada (ciclo completo do mesmo pé). Divide-se em fase de apoio (~60%) e balanço (~40%). A análise da marcha revela compensações dinâmicas." },
      ]},
      { titulo:"Aplicação Clínica e Palmilhas", aulas:[
        { t:"Da avaliação à prescrição", txt:"A avaliação postural usa a inibição das entradas: testa-se a 'estrela de dor' (amplitude e dor nos movimentos), depois muda-se a informação de cada entrada postural e reavalia-se. Isso ajuda a identificar a entrada dominante. A prescrição da palmilha posicionará elementos conforme o achado, atuando como estímulo do STP, não apenas suporte mecânico." },
        { t:"Palmilha postural vs ortopédica", txt:"A palmilha ORTOPÉDICA acomoda e suporta mecanicamente (alívio passivo). A palmilha POSTURAL usa elementos finos (micro-relevos de milímetros) para estimular os receptores plantares e reorganizar o tônus muscular ascendente (correção ativa/neurológica). A FisioPiede integra os dois conceitos conforme o caso clínico." },
      ]},
    ],
    prova:[
      { q:"Quem definiu a posturologia como 'organização de conhecimentos dispersos'?", opts:["Enoka","Gagey","Magee","Galazzo"], correta:1 },
      { q:"O Sistema Tônico Postural integra informações de:", opts:["Apenas os pés","Pés, olhos, oclusão, vestíbulo, pele e articulações","Somente a coluna","Apenas os olhos"], correta:1 },
      { q:"Qual a diferença entre pé causativo e adaptativo?", opts:["Não há diferença","O causativo origina o desequilíbrio; o adaptativo só se ajusta a um problema de cima","O adaptativo é mais grave","Ambos são iguais na prática"], correta:1 },
      { q:"O reflexo cutâneo-podal mostra que:", opts:["O pé não influencia o tônus","Estímulos plantares sutis alteram o tônus muscular à distância","Só a dor importa","A pele não tem receptores"], correta:1 },
      { q:"Quem descreveu o termo baropodometria e em que ano?", opts:["Gagey, 1984","Piero Galazzo, 1986","Magee, 2000","Bell, 1837"], correta:1 },
      { q:"A palmilha POSTURAL difere da ortopédica porque:", opts:["É mais grossa","Usa elementos finos que estimulam receptores e reorganizam o tônus","É apenas decorativa","Não tem elementos"], correta:1 },
      { q:"A entrada dento-oclusal é avaliada:", opts:["Ignorando os dentes","Colocando algodão entre os dentes e reavaliando a postura","Só com raio-x","Não é avaliável"], correta:1 },
      { q:"Na avaliação postural, a 'inibição das entradas' serve para:", opts:["Causar dor","Identificar a entrada postural dominante no desequilíbrio","Medir peso","Nada clínico"], correta:1 },
    ],
  },
  {
    id:"anatomia", titulo:"Anatomia e Biomecânica do Pé", trilha:"Biomecânica Aplicada",
    nivel:"Básico", cor:"#10B981", icon:"🦶", obrigatorio:true, horas:6,
    desc:"Anatomia funcional do pé e tornozelo, footcore e biomecânica aplicada à avaliação e confecção de palmilhas.",
    modulos:[
      { titulo:"Anatomia do Pé", aulas:[
        { t:"Ossos e divisão estrutural", txt:"O pé é constituído por 28 ossos (contando os 2 sesamoides): 7 ossos tarsais, 5 metatarsais e 14 falanges. Divide-se em retropé (tálus e calcâneo), médiopé (navicular, cubóide e 3 cuneiformes) e antepé (metatarsais e falanges). É a única parte do corpo em contato com o solo na postura ortostática." },
        { t:"Articulações de Lisfranc e Chopart", txt:"A articulação tarsometatarsiana (Lisfranc) e a transversa do tarso (Chopart) são fundamentais para a mobilidade e adaptação do pé ao terreno. A subtalar (entre tálus e calcâneo) governa pronação/supinação. A avaliação dessas articulações orienta a flexibilidade necessária na palmilha." },
        { t:"Arcos plantares", txt:"O pé tem três arcos: longitudinal medial (o mais alto, principal absorvedor de choque), longitudinal lateral e transverso (na região metatarsal). Eles funcionam como molas que armazenam e devolvem energia na marcha. A redução do arco medial caracteriza o pé plano; o aumento, o pé cavo." },
      ]},
      { titulo:"Footcore e Musculatura", aulas:[
        { t:"O conceito de footcore", txt:"O footcore (McKeon et al., 2015) descreve a musculatura intrínseca do pé como um sistema de estabilização ativo do arco plantar, análogo ao core do tronco. Compõe-se de músculos plantares profundos que sustentam dinamicamente os arcos. Seu fortalecimento é essencial no tratamento de fascite, pé plano e instabilidades." },
        { t:"Cadeias musculares ascendentes", txt:"O pé inicia cadeias musculares que sobem pela perna, coxa e tronco. Uma disfunção no apoio plantar (ex: pronação excessiva) gera rotação interna da tíbia, valgo de joelho e báscula pélvica. Por isso a palmilha postural tem efeito que vai muito além do pé." },
      ]},
      { titulo:"Desvios e Tipos de Pé", aulas:[
        { t:"Retropé valgo e varo", txt:"Retropé VALGO: eversão do calcâneo com a subtalar neutra; mais móvel, causa menos problemas, mas pode contribuir para pé plano. Retropé VARO: inversão do calcâneo; limita a pronação e pode contribuir para pé cavo, exostose retrocalcânea, canelite, fascite plantar e patologias de joelho e tornozelo." },
        { t:"Antepé valgo e varo, graus de pé plano/cavo", txt:"O antepé também pode estar em valgo ou varo em relação ao retropé, exigindo compensações. Pé plano e pé cavo são classificados em graus (1 a 4) conforme a severidade da alteração do arco. A graduação orienta a intensidade da correção na palmilha." },
      ]},
    ],
    prova:[
      { q:"Quantos ossos formam o pé (com os sesamoides)?", opts:["20","26","28","32"], correta:2 },
      { q:"Tálus e calcâneo formam o:", opts:["Antepé","Médiopé","Retropé","Hálux"], correta:2 },
      { q:"O footcore se refere a:", opts:["Os ossos do tornozelo","A musculatura intrínseca estabilizadora do pé","O salto do calçado","Os nervos plantares"], correta:1 },
      { q:"Qual arco é o principal absorvedor de choque?", opts:["Transverso","Longitudinal lateral","Longitudinal medial","Não há arcos"], correta:2 },
      { q:"Uma pronação excessiva do pé tende a causar:", opts:["Rotação externa da tíbia","Rotação interna da tíbia e valgo de joelho","Nenhum efeito acima do pé","Aumento do arco"], correta:1 },
    ],
  },
  {
    id:"palmilhas3d", titulo:"Palmilhas Posturais 3D", trilha:"Palmilhas Posturais 3D",
    nivel:"Avançado", cor:"#F59E0B", icon:"🦿", obrigatorio:true, horas:8,
    desc:"Confecção de palmilhas posturais: elementos, materiais e a tecnologia exclusiva FisioPiede — escaneamento 3D, modelagem digital e impressão em TPU de alta performance com arcos moldados, pioneira no Brasil.",
    modulos:[
      { titulo:"História e Conceito", aulas:[
        { t:"Da palmilha mecânica à postural", txt:"Inicialmente as palmilhas tinham caráter exclusivamente mecânico (escola francesa). Na década de Bourdiol introduziu um conceito novo: correções não apenas mecânicas, mas NEUROLÓGICAS. Os posturologistas perceberam que o conceito mecânico ignorava a propriocepção fina do pé — uma 'cegueira postural'. Nasceu então a palmilha postural, que usa estímulos mínimos para rearmonizar o sistema postural." },
        { t:"Palmilha postural vs ortopédica", txt:"A ortopédica acomoda e suporta (alívio passivo). A postural usa elementos finos (milímetros) que estimulam receptores plantares e reorganizam o tônus muscular ascendente (correção ativa/neurológica). A FisioPiede integra os dois conceitos conforme o caso, redistribuindo corretamente as pressões plantares." },
      ]},
      { titulo:"Elementos Posturais", aulas:[
        { t:"Barras, cunhas e botões", txt:"Barra retrocapital (atrás das cabeças metatarsais, na fascite), barra infracapital (sob as cabeças, no neuroma/metatarsalgia), botão flexor (estímulo da musculatura intrínseca), cunhas pronadoras/supinadoras (controle do eixo do retropé/antepé) e suportes de arco. Cada elemento tem indicação específica conforme a patologia e o achado biomecânico." },
        { t:"Descargas e estímulos proprioceptivos", txt:"Descargas em PORON aliviam áreas de dor ou calosidade. Os micro-relevos (elementos de milímetros) atuam pelo reflexo cutâneo-podal, modificando as cadeias proprioceptivas ascendentes. O posicionamento preciso é definido pela avaliação e pela baropodometria." },
      ]},
      { titulo:"Materiais", aulas:[
        { t:"EVA, PORON e gel", txt:"EVA em diferentes densidades para estrutura e correção (mais denso = mais corretivo); PORON para amortecimento e descargas; gel para absorção de impacto. A combinação define o equilíbrio entre correção e conforto, conforme o objetivo clínico e o perfil do paciente (atleta, idoso, diabético)." },
      ]},
      { titulo:"Tecnologia FisioPiede — Palmilhas 3D Personalizadas", aulas:[
        { t:"Etapa 1 — Avaliação biomecânica e postural", txt:"O processo começa com uma avaliação minuciosa feita pelo fisioterapeuta, que analisa a postura, a marcha, a pisada e as alterações biomecânicas do paciente. Com base nisso, o profissional preenche um protocolo técnico exclusivo, especificando as necessidades terapêuticas e os elementos corretivos que serão incorporados à palmilha para cada caso." },
        { t:"Etapa 2 — Escaneamento 3D dos pés", txt:"É realizado o escaneamento tridimensional (3D) dos pés, capturando com extrema precisão a anatomia plantar do paciente. Esse molde digital exato é a base sobre a qual a palmilha será construída, garantindo que ela respeite a anatomia individual de cada pessoa." },
        { t:"Etapa 3 — Modelagem digital avançada", txt:"Com os dados clínicos e o escaneamento, a equipe especializada usa um software de última geração para modelagem biomecânica. A palmilha é construída digitalmente sobre o molde exato dos pés, com a inserção PRECISA dos elementos corretivos prescritos pelo fisioterapeuta. Cada correção é posicionada exatamente onde é necessária — um nível de personalização muito superior ao processo convencional." },
        { t:"Etapa 4 — Impressão 3D em TPU de alta performance", txt:"As palmilhas são produzidas por impressão 3D em TPU (Poliuretano Termoplástico) de alta performance — material importado, puro, flexível e extremamente resistente. O TPU oferece: alta durabilidade, excelente memória elástica, maior conforto, resistência à deformação e capacidade de absorção e dissipação de impactos." },
        { t:"Pioneirismo: arcos moldados na impressão", txt:"A tecnologia FisioPiede é pioneira no Brasil por permitir fabricar palmilhas com os arcos anatômicos moldados diretamente na impressão. Isso reproduz com alta fidelidade a qualidade e a eficiência biomecânica das palmilhas artesanais tradicionais — porém com precisão digital e padronização superior, reprodutível em toda a rede." },
        { t:"Personalização total e o diferencial FisioPiede", txt:"Cada palmilha é produzida de forma individual e exclusiva, considerando: anatomia plantar, alterações posturais, necessidades biomecânicas, objetivos terapêuticos e os elementos corretivos prescritos. A combinação de avaliação clínica + escaneamento 3D + modelagem digital + impressão em TPU resulta em uma órtese de alta precisão, com respostas terapêuticas mais rápidas, mais conforto e mais precisão no tratamento." },
      ]},
    ],
    prova:[
      { q:"Qual material é mais indicado para descargas e amortecimento?", opts:["EVA de alta densidade","PORON","Madeira","Metal"], correta:1 },
      { q:"A palmilha moldada se caracteriza por:", opts:["Ser igual para todos","Ser conformada ao pé do paciente","Não usar materiais","Ser feita de papel"], correta:1 },
      { q:"Quem introduziu o conceito de correção neurológica (não só mecânica)?", opts:["Galazzo","Bourdiol","Enoka","Magee"], correta:1 },
      { q:"A barra retrocapital é indicada principalmente para:", opts:["Neuroma de Morton","Fascite e alívio metatarsal posterior","Joanete","Pé cavo apenas"], correta:1 },
      { q:"A principal vantagem da impressão 3D é:", opts:["Ser mais barata sempre","Precisão milimétrica e reprodutibilidade","Dispensar avaliação","Não usar materiais"], correta:1 },
      { q:"Qual material a FisioPiede usa na impressão 3D das palmilhas?", opts:["EVA comum","TPU (Poliuretano Termoplástico) de alta performance","Madeira","Silicone"], correta:1 },
      { q:"O que torna a tecnologia FisioPiede pioneira no Brasil?", opts:["Usar papel","Arcos anatômicos moldados diretamente na impressão","Não fazer avaliação","Palmilhas iguais para todos"], correta:1 },
      { q:"Qual a sequência correta do processo FisioPiede?", opts:["Imprime e depois avalia","Avaliação → escaneamento 3D → modelagem digital → impressão TPU","Só escaneia","Compra pronta"], correta:1 },
    ],
  },
  {
    id:"fundamentos", titulo:"Fundamentos FisioPiede", trilha:"Fundamentos FisioPiede",
    nivel:"Básico", cor:"#06B6D4", icon:"🎓", obrigatorio:true, horas:4,
    desc:"Onboarding da rede FisioPiede: filosofia, fluxo de atendimento, padrões de qualidade e uso da plataforma.",
    modulos:[
      { titulo:"Bem-vindo à Rede", aulas:[
        { t:"A filosofia FisioPiede", txt:"A FisioPiede une tecnologia e fisioterapia para entregar palmilhas posturais 3D com excelência clínica padronizada em toda a rede. O licenciado segue protocolos validados, garantindo resultado consistente ao paciente." },
        { t:"Fluxo de atendimento padrão", txt:"Avaliação completa → seleção de protocolo → prescrição de palmilha → produção 3D → entrega e acompanhamento. Cada etapa é registrada na plataforma para rastreabilidade e qualidade." },
      ]},
    ],
    prova:[
      { q:"Qual o diferencial central da FisioPiede?", opts:["Preço baixo","Palmilhas posturais 3D com protocolo padronizado","Atendimento sem avaliação","Venda de calçados"], correta:1 },
    ],
  },
];



const ACADEMY_GLOSSARIO = [
  { termo:"Sistema Tônico Postural (STP)", def:"Conjunto de estruturas neurológicas que mantêm o corpo ereto contra a gravidade, integrando entradas dos pés, olhos, oclusão, vestíbulo, pele e articulações." },
  { termo:"Entrada Postural", def:"Via sensorial que informa o STP sobre a posição do corpo. As principais são a podal (pés), ocular (olhos) e dento-oclusal (mandíbula/dentes)." },
  { termo:"Pé Causativo", def:"Pé que é a ORIGEM do desequilíbrio postural — a disfunção começa nele. Responde bem à palmilha postural." },
  { termo:"Pé Adaptativo", def:"Pé que apenas se ADAPTA a um desequilíbrio vindo de outra entrada (ocular, oclusal, cicatriz). A palmilha isolada tem menos efeito." },
  { termo:"Reflexo Cutâneo-Podal", def:"Resposta neurológica em que estímulos sutis na planta do pé alteram o tônus muscular à distância. Base científica dos elementos posturais." },
  { termo:"Baropodometria", def:"Estudo da distribuição das pressões plantares (estática e dinâmica) por plataforma de sensores. Galazzo, 1986." },
  { termo:"Centro de Pressão (CoP)", def:"Ponto médio de aplicação das forças de reação do solo. Seu deslocamento (estatocinesiograma) reflete o controle postural." },
  { termo:"Estabilometria", def:"Medição das oscilações do corpo na posição em pé, usada para avaliar o equilíbrio e o controle postural." },
  { termo:"Pêndulo Invertido", def:"Modelo que descreve o corpo humano oscilando sobre a base de apoio dos pés, em constante reequilíbrio." },
  { termo:"Sistema Tampão", def:"Local do corpo onde se compensa um desequilíbrio postural: cintura escapular, cintura pélvica e pés." },
  { termo:"Footcore", def:"Musculatura intrínseca do pé que estabiliza ativamente o arco plantar, análoga ao core do tronco (McKeon, 2015)." },
  { termo:"Pronação", def:"Movimento combinado de eversão, abdução e dorsiflexão; em excesso, associa-se a pé plano e rotação interna da tíbia." },
  { termo:"Supinação", def:"Movimento de inversão, adução e flexão plantar; em excesso, associa-se a pé cavo e sobrecarga lateral." },
  { termo:"Barra Retrocapital", def:"Elemento posicionado atrás das cabeças dos metatarsos para aliviar a região metatarsal (ex: metatarsalgia)." },
  { termo:"Cunha (pronadora/supinadora)", def:"Elemento em rampa que controla a pronação ou supinação do retropé/antepé, corrigindo o eixo de apoio." },
  { termo:"Elemento Postural", def:"Micro-relevo de milímetros na palmilha que estimula receptores plantares e reorganiza o tônus muscular ascendente." },
];

const ACADEMY_TRILHAS = [
  { nome:"Fundamentos FisioPiede", icon:"🎓", cor:"#06B6D4", cursos:["fundamentos"] },
  { nome:"Avaliação Postural", icon:"🧍", cor:"#8B5CF6", cursos:["posturologia"] },
  { nome:"Baropodometria Clínica", icon:"👣", cor:"#3B82F6", cursos:["baropodometria"] },
  { nome:"Biomecânica Aplicada", icon:"🦶", cor:"#10B981", cursos:["anatomia"] },
  { nome:"Palmilhas Posturais 3D", icon:"🦿", cor:"#F59E0B", cursos:["palmilhas3d"] },
  { nome:"Casos Clínicos", icon:"📋", cor:"#EC4899", cursos:[] },
  { nome:"Protocolos Avançados", icon:"⚗️", cor:"#A855F7", cursos:[] },
  { nome:"Vendas Consultivas", icon:"💼", cor:"#14B8A6", cursos:[] },
  { nome:"Gestão de Clínica", icon:"📊", cor:"#F97316", cursos:[] },
  { nome:"Formação Master FisioPiede", icon:"👑", cor:"#EF4444", cursos:[] },
];

const ACADEMY_BIBLIOTECA = [
  { titulo:"Apostila FisioPiede — Anatomia e Protocolos", tipo:"Apostila", paginas:180, icon:"📕", cor:"#3B82F6", desc:"Material completo de anatomia do pé, footcore e protocolos clínicos FisioPiede.", conteudo:[{cap:"Anatomia do Pé",txt:"ANATOMIA NETTER, FH. Atlas de Anatomia Humana. 2022 Pé está constituído por:7 ossos tarsais5 metatarsais14 falanges Divididos em:POSTERIOR: tálus e calcâneo (retropé)MÉDIA: navicular, cubóide e cuneiformes (médiopé)ANTERIOR: metatarsais e falanges (antepé) Divisão estrutural Articulaçãotarsometatarsiana:(Lisfranc) Articulação transversa do tarso :(Chopart) ANATOMIA NETTER, FH. Atlas de Anatomia Humana. 2022 Divisão articular ANATOMIAFootcore McKeonP , et al. BrJ Sports Med, 2015. ANATOMIAFootcore McKeonP , et al. BrJ Sports Med, 2015. ANATOMIAArcos plantares ArcoLongitudinalMedial ArcoLongitudinalLateral ArcoTransverso MageeD. Avaliação Musculoesquelética. São Paulo: Manole; 2010. ANATOMIA ArcoLongitudinalMedial ArcoLongitudinalLateral ArcoTransverso MageeD. Avaliação Musculoesquelética. São Paulo: Manole; 2010. Arcos plantares ANATOMIA ArcoLongitudinalMedial ArcoLongitudinalLateral ArcoTransverso MageeD. Avaliação Musculoesquelética. São Paulo: Manole; 2010. Arcos plantares ANATOMIATipos de pés ArcoNormal Péplano:reduçãodoarcolongitudinalmedial. Pécavo:aumentodoarcolongitudinalmedial MageeD. Avaliação MusculoesqueléLca. São Paulo: Manole; 2010."},{cap:"Footcore e Biomecânica",txt:"ANATOMIAArco NORMAL ANATOMIAPé PLANO ANATOMIAPé CAVO ANATOMIAPé PLANO ValarezoM. PosturologíaClínica -Quito; 2011. BricotB. Posturologia. São Paulo: Ícone; 2001.RicardF. Colecciónde Medicina OsteopáLca. Madrid;2012. GRAU 1GRAU 2GRAU 3GRAU 4 ANATOMIA ValarezoM. PosturologíaClínica -Quito; 2011. BricotB. Posturologia. São Paulo: Ícone; 2001.RicardF. Colecciónde Medicina Osteopática. Madrid;2012. GRAU 1GRAU 2GRAU 3 Pé CAVO ANATOMIARetropéVALGO MageeD. Avaliação Musculoesquelética. São Paulo: Manole; 2010. Eversãodocalcâneoquandoasubtalarestáemposiçãoneutra.Poderesultardeumjoelhovalgoepodecontribuirparaumpéplano. Porsermaismóvel,causamenosproblemasqueumretropévaro. ANATOMIA MageeD. Avaliação MusculoesqueléLca. São Paulo: Manole; 2010. Inversãodocalcâneoquandoaarticulaçãosubtalarestáemposiçãoneutra.Apronaçãoélimitada.Podecontribuirparaumpécavo. Estedesviopodecontribuirparaexostoseretrocalcânea,canelite,fasciiteplantar,distensõesposterioresdecoxaepatologiasdejoelhoetornozelo. RetropéVARO ANATOMIAAntepéVALGO MageeD. Avaliação Musculoesquelética. São Paulo: Manole; 2010. Eversãodoantepésobreoretropéquandoaarticulaçãosubtalarestáemposiçãoneutra...."}] },
  { titulo:"Posturologia Osteopática", tipo:"Apostila", paginas:144, icon:"📗", cor:"#8B5CF6", desc:"Fundamentos da posturologia, entradas posturais, baropodometria e confecção de palmilhas.", conteudo:[{cap:"História da Posturologia",txt:"História da Posturologia HISTÓRIA DA POSTUROLOGIA “A posturologia clínica surgiu como a organização de conhecimentos dispersos, validando uma sintomatologia mal conhecida” (Gagey) A posturologia é um método de avaliação global do corpo que tem como objetivo evitar desequilíbrios crônicos ocasionados pel os desajustes posturais. A preocupação com a postura humana surge em primeira instância como uma necessidade e preocupação artística. • 1837 – Charles Bell se pergunta: “Como faz um homem para manter uma postura direita ou inclinada contra o vento? “ • 1880 – Vierordt descreve a oscilação permanentemente do corpo humano em posição ortostática. • 1953 – Ranquet constrói a primeira plataforma de estabilometria. • 1955 - Baron apresenta as modificações proprioceptivas interferindo na postura. • 1980 – Da Cunha, é o primeiro a estudar a “Síndrome do déficit Postural” • 1984 – Criada a primeira Associação de Posturologia na França. • 1994- Marino e Villeneuve, relacionaram o sistema estomatognático ao sistema postural; • 1996- Barral, Upledger, Jones, entre outros, relac ionaram a TERAPIA MANUAL x POSTUROLOGIA; O que é a posturologia? Ciência do equilíbrio humano → surge da necessidade do homem de conhecer certos mecanismos posturais. Começa-se a compreender as vias através das quais o homem é capaz de manter -se erguido e de adaptar-se aos fenômenos gravitacionais. O termo posturologia tem sido usado para descrever a disciplina que estuda as relações entre as diversas posturas..."},{cap:"Postura e Equilíbrio",txt:"POSTURA POSTURA A postura segundo Enoka (2000) é uma resposta neuromecânica que se relaciona com a manutenção do equilíbrio. Diz ainda que um sistema está em equilíbrio mecânico quando a somatória de forças que atuam sobre ele é igual a zero. Entretanto, esse sistema tem estabilidade somente se após uma perturbação o mesmo retornar a sua posição de equilíbrio. Para Magee é um composto das posições das difere ntes articulações do corpo num dado momento. A postura correta é a posição na qual um mínimo de estresse é aplicado em cada articulação. Define postura como qualquer posição que determine a manutenção do equilíbrio com o MÁXIMO de estabilidade, MÍNIMO consumo energético e mínima sobrecarga nas estruturas anatômicas. Saad et al. (1997), relatam que estudos recentes em neurociências mostram que as mudanças ocorridas no sistema tônico-postural não dependem exclusivamente do ouvido interno, mas na maioria dos casos de receptores sensitivos internos e externos sendo os mais importantes os olhos e os pés. É extremamente complexo e intervém de forma permanente no ato de levantar -se, sentar-se, manter -se em pé e, se opor as forças externas contribuindo para o início dos movimentos. Sistema tampão na posturologia é o local onde se compensa um desequilíbrio postural. São eles: cintura escapular, cintura pélvica e pés. Pêndulo invertido: O homem está em constante oscilação graças ao trabalho das diferentes cadeias posturais, que se adaptam de maneira permanente para permitir que..."},{cap:"O Diafragma",txt:"DIAFRAGMA DIAFRAGMA Diafragma e seu papel postural Relações anatômicas: Diafragma por definição é qualquer membrana ou placa que divide duas cavidades ou duas partes da mesma cavidade. O nome diafragma tem origem do grego dia (através) juntamente a phragma (feixe). É uma lâmina musculotendínea, larga e fina, em forma de cúpula que compõe o assoalho da cavidade torácica, através de sua face superior convexa, e o teto da cavidade abdominal, por meio de sua superfície inferior côncava, separando assim duas cavidades. O músculo diafragma é descrito como um f eixe muscular e tendi noso, que separa a cavidade torácica da cavidade abdominal. Seu centro é fibroso (centro frênico) enquanto as partes periféricas são musculares. Pode-se considerar o diafragma como formado por pequenos músculos digástricos (com dois ventres), intermediadas por tendões, os quais formam o centro tendíneo. Desta forma o músculo possui uma porção muscular periférica e uma porção aponeurótico central. Inserção anterior: processo xifoide do osso esterno Inserção posterior: pilar direito (vértebras de L1 até L3 -L4); pilar esquerdo (vértebras L1 a L2-L3). ➢ Ligações fasciais e conectivas entre o diafragma e o assoalho pélvico e o resto do corpo. ➢ Relação das fáscias do diafragma com diversas outras estruturas do corpo. ➢ Uma alteração fisiológica em qualquer parte do corpo afetará tudo o que é coberto por essa folha conectiva. Quando consideramos que os pilares diafragmáticos podem ter uma ação para cima, a..."},{cap:"Cicatrizes e Postura",txt:"CICATRIZES CICATRIZES Anatomia - Interação entre os tecidos Toda alteração relacionada ao tecido fascial, principalmente aderências cicatriciais podem, e na maioria das vezes irão afetar o movimento. Vamos pensar em uma cirurgia de cesariana. A cicatriz de cesariana é localizada na região supra púbica, medindo por volta de a cm. De maneira simplificada o corte acontece em camadas de tecido da pele até o útero. A primeira camada é a pele (derme e epiderme), seguida da fáscia superficial composta de camada de tecido adiposo, fásci a superficial e mais uma camada de tecido adiposo, em seguida fáscia muscular (empesa) e o próprio músculo, logo o peritônio parietal e peritônio visceral e por fim o próprio útero. Portanto, qualquer perda de deslizamento entre as camadas teciduais, pode sobrecarregar ou dificultar o movimento. De forma simplificada vamos abordar um pouco sobre os tipos celulares. - Queratinócitos (80 a 90%) são células diferenciadas do tecido epitelial (pele) responsáveis pela síntese da queratina. Presentes principalmente no tecido da epiderme. A principal função dos queratinócitos é produzir queratina, uma proteína fibrosa que faz, por exemplo, da epiderme uma camada protetora. Um atrito persistente, por exemplo por um sapato pouco adaptado ao pé, provoca um engrossamento da epiderme, com queratinócitos, denominado calo. - Melanócitos: Os melanócitos são células dendríticas que produzem a melanina, essas células são encontradas entre a junção da derme com a..."},{cap:"Tendão Central",txt:"TENDÃO CENTRAL Dentro do conceito que consideramos, é a continuidade de uma série de tecido conjuntivo visualizada através de várias estruturas, assim como músculos, tendões, ligamentos, aponeuroses, fáscia e etc. Podemos iniciar essa viagem pelo assoalho pélvico. Seguimos com o músculo psoas, esse através do ligamento arqueado medial (espessamento da fáscia do psoas) chega até o diafragma. Uma outra via ascendente seria pela bexiga, através do ligamento uraco segue através do ligamento redondo e falciforme, chegando ao diafragma pelo fígado. Na sequência temos que o tendão central se continua pelo ligamento vertebro- pericárdio, ligamento esse que interliga a transição cérvico -torácica com o saco pericárdio. Depois temos os ligamentos que fixam o saco pericárdio no esterno: ligamentos esterno - pericárdio e ligamentos que fixam o saco pericárdio no diafragma: ligamento frênico - pericárdio. Existe uma relação importante entre o ligamento vertebro-pericárdio e o músculo constritor inferior da faringe, logo seguimos pelo médio e superior, este se liga na base do crânio e pode interferir na dura-máter. Outra via segue com a relação desses músculos com bucinador e ao mesmo tempo toda uma relação com a musculatura extrínseca da lín gua. Conectando mandíbula, temporal, palato e acaba chegando na base de crânio. Quando pensamos nos ligamentos esterno -pericárdio podemos seguir pela pelo esterno e conectar os infra e supra-hioideos. Se começarmos a explicar pelo crânio, temos que..."},{cap:"Entrada Ocular",txt:"ENTRADA OCULAR ENTRADA OCULAR Uma das mais importantes entradas da posturologia, por proporcionar relação do corpo com os objetos no meio ambiente. Funciona como um endocaptor (relacionado com a propriocepção e musculatura ocular) e exterocaptor (relacionado com a visão), intervindo prioritariamente no equilíbrio estático e dinâmico. Segundo Mossi (2002), na manutenção da estática ereta o elemento mais importante não é visão central, mas sim a periférica que irá atingir a evolução completa aos anos. Estudo realizado por Baron 1951 mostrou a relação da secção do re to lateral com atitudes escolióticas em peixes; Estudos demonstram que 85% dos indivíduos têm problemas ligados ao desequilíbrio do olho. Do ponto de vista evolutivo, as informações da visão têm três utilidades principais: • Observação de objetos móveis e imóveis; • Percepção de sua própria posição no espaço; • Manutenção de uma postura adequada. Segundo Latash (1998), o equilíbrio é extremamente influenciado pelo sentido da visão e a estabilidade da postura corporal torna -se mais complicada com os olhos fechados. Porém, muitas vezes observa -se o contrário quando temos a lterações primárias desta entrada postural Olho Aberto Olho Fechado Estudos realizados por neurofisiologistas determinou que os músculos de ambos os olhos, os músculos do pescoço e de todo o corpo estão estritamente relacionados e qualquer modificação no funcionamento dos músculos oculares pode acarretar alterações posturais. Todos os..."},{cap:"Entrada Dento-Oclusal",txt:"ENTRADA DENTO- OCLUSAL ENTRADA DENTO-OCLUSAL • Unidade funcional do organismo onde diferentes tecidos vão atuar harmoniosamente na realização de diversas tarefas funcionais. • É um sistema que compreende: maxila, mandíbula, tecidos moles (glândulas, vascular e nervosa), dentes, ATM e os músculos. • Este sistema deve oferecer uma posição mandibular favorável para a ATM e para a relação oclusal (dentes). Se esta entrada postural não atua diretamente na regulação tônica postural, suas perturbações serão elementos desestabilizadores através do: - Sistema muscular; - Sistema óculo-motor e diferentes formações centrais; - Descompensação do nervo acessório (NC XI); - Descompensação craniana. Considerando o aparelho estomatognático um sistema constituído da mandíbula, ATM, osso hioide, coluna cervical e dos músculos que se originam desta estrutura, permite - nos melhor compreensão de como as alterações dos receptores podálicos podem interferir no equilíbrio oclusal (alterações ascendentes) e vice -versa, desequilíbrio oclusal alterar o apoio plantar (alteração descendente) (BRACCO,ARMANDI,CERRATO, 2005). • 1988 Bataglion et al → associações de desordens temporomandibulares e cervicalgia. • SNC recebendo aferências de receptores localizados na cavidade oral, músculo e ATM. • Todo desequilíbrio do aparelho mastigatório poderá, repercutir sobre o conjunto do sistema tônico postural (BRICOT, 2001; OKESON, 2000) A postura anterior da cabeça tem sido associada à diminuição da dimensão..."},{cap:"Entrada Podal",txt:"ENTRADA PODAL ENTRADA PODAL Uma das principais vias de entrada posturais. Responsável pela propriocepção do corpo em relação ao solo. O pé é um conjunto proprioceptivo e exteroceptivo excepcional, que recebe informações dos músculos, das articulações e da pele. Dois conceitos distintos envolvendo o pé: - Via de entrada de informações - Via de saída de informações O homem é um pêndulo invertido que se equilibra sobre um triângulo, formado por duas peças normalmente simétricas: os pés. Nosso corpo oscila em um eixo de graus. Frequência de 0,3Hz – segundos para realizar uma oscilação completa. Sistema tampão: local onde se compensa um desequilíbrio Pé → tampão terminal e um pêndulo invertido ➢ Receptores musculares: responsáveis mediante o reflexo miotático a tonicidade dos músculos posturais antigravitacionais ➢ OTG sensíveis ao estiramento ➢ Corpúsculos de Vater Pacini: informação sobre a posição das distintas articulações. ➢ Pele: -exocaptor (receptores barométricos da planta dos pés - Pacini) -endocaptor (FNM - OTG) Planta do pé inervado pelo nervo tibial. ANATOMIA DOS PÉS O pé é composto por ossos (28 se contados os dois sesamóides), divididos em retropé, médiopé e antepé. Os ossos dos pés estão estruturados para suportar o peso do corpo. É a única parte do corpo em contato com o chão quando estamos em postura ortostática e desempenham diferentes funções: ✓ atuam como amortecedores ✓ auxílio na manutenção do equilíbrio ✓ proporcionam impulsão, elasticidade e flexibilidade..."},{cap:"Baropodometria",txt:"BAROPODOMETRIA BAROPODOMETRIA Termo descrito por Piero Galazzo em 1986, podo: pé; baro: pressão; metron: medida É o estudo da distribuição das pressões plantares tanto estática como dinâmicas , através de uma plataforma eletrônica; os sensores captam infor mações sobre as pressões que ocorrem entre o solo e a superfície plantar . Esta forma de avaliação conduz a compreensão da biomecânica do pé e sua posterior aplicação em processos patológicos. Quando ocorre qualquer alteração no apoio, entende -se que have rá interferência na biomecânica corporal, o que refletirá em sintomatologia nos pés e em outros segmentos. Definimos então o baropodômetro como um equipamento desenvolvido para a análise dos pontos de pressão plantar exercido pelo corpo, tanto em posição estática quanto em movimento. Um software avalia estes impulsos em imagens e dados estatísticos. Através da utilização do baropodômetro podemos analisar: Distribuição das cargas em condições ortostáticas; Estabilometria do paciente em posição estática; Transferência dinâmica da carga durante a fase do passo; Picos de pressão e tempo de contato no solo; * É um instrumento auxiliar à prescrição de palmilhas. Seguindo dois modelos de avaliação o Europeu e o Americano, podemos verificar duas formas de posicionamento do paciente na literatura: Modelo Europeu de avaliação: calcâneos unidos e dedos afastados Modelo Americano de avaliação: pés paralelos Testes com os olhos abertos e mandíbulas relaxadas; olhos fechados e dentes..."},{cap:"Marcha",txt:"MARCHA Forma de locomoção bípede que demanda interação entre os sistemas neuromotor, sensorial, musculoesquelético, e requer mínimo consumo de energia metabólica. É uma sequência repetitiva de movimentos dos membros inferiores que move o corpo para frente enquanto simultaneamente mantém a estabilidade no apoio. Conceitos em Cinemática • - cadência: é o número de passos dados em uma unidade de tempo, normalmente expresso como passos por minuto • - passo: é o espaço compreendido entre o contato inicial de um pé e o co ntato inicial do pé contralateral no solo. • - passada: é o espaço compreendido entre o contato inicial de um pé no solo e o novo contato inicial do mesmo pé. O ciclo da marcha é o período compreendido entre o primeiro contato do pé com o solo até o próximo contato deste mesmo pé com o solo. É dividido em duas fases: • APOIO - pé encontra-se em contato com o solo • BALANÇO - pé é elevado do solo para o avanço do membro. Perry, 2010, cita como referências para adultos normais os seguinte dados: • - Velocidade: m/min • - Cadência: passos/min • - Comprimento da passada: 1,4m • - Medida do passo: 0,75m • - Tempo de balanço: 40% do ciclo • - Tempo de apoio: 60% do ciclo Fases da marcha: APOIO ✓ Apoio do calcanhar ✓ Aplanamento do pé ✓ Acomodação intermediária ✓ Impulso BALANÇO ✓ Aceleração ✓ Oscilação intermediária ✓ Desaceleração"},{cap:"Palmilhas",txt:"PALMILHAS PALMILHAS POSTURAIS Há aproximadamente anos alguns autores atribuíram um papel postural às palmilhas ortopédicas na prevenção nas alterações da pelve, das escolioses e do tratamento das lombalgias. Foi então na década de que Bourdiol apresentou um conceito terapêutico novo, no qual as correções posturais não se riam somente mecânicas, mas sim neurológicas. Assim, as bases neurofisiológicas propiciaram o surgimento da posturologia. A confecção de palmilhas posturais teve seu início na escola Francesa onde as palmilhas eram realizadas dentro de um caráter exclusiv amente mecânico. Os posturologistas foram constatando que este conceito mecânico não trazia respostas satisfatórias, ignorando -se a propriocepção fina do pé, gerando uma forma de “cegueira postural”. Com isto foi amadurecendo o conceito de posturologia de forma mais global e proprioceptiva aplicado atualmente, na qual se utiliza a idéia de estímulos mínimos nas plantas dos pés para rearmonizar o sistema postural. Apresenta -se então como uma abordagem preventiva e terapêutica para a regulação dos distúrbios posturais influenciados pelos pés e reprogramados através da utilização de palmilhas posturais. Estas palmilhas são compostas por diversos elementos na região plantar pré -definidos pela avaliação realizada e têm como objetivo reequilibrar e redistribuir corretamente as pressões plantares no solo. Estes elementos fornecem informações aferentes ao sistema nervoso e como resposta eferente o corpo produz..."},{cap:"Elementos Posturais",txt:"ELEMENTOS Reflexo Cutâneo-Podal • Uma estimulação plantar de a gramas ao nível dos primeiros cuneiformes aumenta o tônus dos músculos rotadores laterais do quadril homolateral. • Uma estimulação ao nível do processo estilóide do quinta metatarso aumenta o tônus muscular dos rotadores mediais do quadril homolateral. • Consiste em estimular zonas reflexas da planta dos pés através de micro relevos entre e mm. • Modificação na ativação das cadeias proprioceptivas ascendentes e correção de variáveis posturais. • Ocorre pela estimulação dos mecanorreceptores da região plantar atuando no sistema postural fino. Na confecção das palmilhas posturais, também descritas como sensoriais, são utilizados elementos que são fixados na palmilha em contato com a planta dos pés. Estes elementos fornecem informações ao sistema postural fino e como resposta, o corpo produz um reequilíbrio postural através das reações reflexas tônicas musculares, corrigindo desta forma as assimetrias posturais. Elementos ortopédicos São os elementos com mais de 3mm de altura. Deve ser evitada ao máximo sua utilização, pois não estimulam a propriocepção apenas tentam corrigir mecanicamente o posicionamento de determinada estrutura. Elementos proprioceptivos Elementos de a 3mm que estimulam o reflexo de correção. Agem na propriocepção muscular do pé, gerando modificações na ativação da cadeia proprioceptiva ascendente. Não tem por objetivo bascular peças ósseas, mas sim agir por vias reflexas, modificando a..."},{cap:"Avaliação Postural",txt:"AVALIAÇÃO AVALIAÇÃO Inibição das entradas posturais : O teste inicia -se com a avaliação dos movimentos dolorosos na estrela de dor (amplitude e dor). A segui r mudamos a informação da entrada postural e testamos os movimentos dolorosos novamente. Isso pode ser feito com todas as entradas posturais. Até o momento não existe uma comprovação clássica destes testes. Porém, estudos indiretos e prática clínica, nos dão boas informação. Quando testamos o STP é possível observar uma boa relação de teste e reposta positiva ou negativa. Quando estamos testando a dor, existem vários parâmetros para serem avaliados, p rincipalmente o tipo de dor que o paciente apresenta. Basicamente, quando o teste é positivo para dor (mais que 50%) ele nos dá uma ótima relação para tratamento. No entanto se ele é negativo, mas tem características de uma com alteração do STP, mais teste positivo para STP não devemos excluir o tratamento. • Entrada podal: colocar um elemento na(s) alteração(ões) que mais chame atenção. (Principalmente retro-pé e/ou perna curta); • Entrada ocular: o paciente com olhos fechados realizar movimentos ocu lares pa ra desprogramar a entrada postural , 3x cada movimento para cima, para baixo, para um lado e para outro. • Entrada dento-oclusal: colocar um palito ou gaze entre os inci sivos, realizar movimentos com a mandíbula. Em alguns casos será necessário suprir a ausên cia de dentes com uma gaze. Ou colocar sustentações em pontos específicos nos dentes, relacionados à..."},{cap:"Confecção de Palmilha Básica",txt:"MANUTENÇÃO E ALTA DIA O QUE FAZER? 1ª Consulta Avaliação e prescrição da palmilha se necessário → Confecção 2ª Consulta (90 dias) Reavaliação do elementos e modificações na palmilha (se necessário) 3ª Consulta (90 dias) Reavaliação do elementos e modificações na palmilha (se necessário) 4ª Consulta (180 dias) Reavaliação do elementos e modificações na palmilha (se necessário). Caso seja possível alta e orientação sobre o desmame. 5ª Consulta (180 dias) Reavaliação do elementos e alta. Orientação ao desame. Orientações ao entregar a palmilha: Obs.: Orientações para o desmame: Após a retirada dos elementos é necessário um desmame da palmilha. Feito da seguinte forma: Utilizar a palmilha dia sim dia não por uma semana; Utilizar a palmilha dias não, um dia sim por uma semana; - Continuar esta tendência até que o paciente consiga ficar totalmente sem a palmilha. CONFECÇÃO PALMILHA BÁSICA 1) Com o gabarito do tamanho exato para o paciente, desenhar na placa base o formato da palmilha. 2) Após desenhar o gabarito na placa base, cortar com uma tesoura o contorno feito. 3) Desenhar na plantigrafia o mesmo gabarito utilizado na placa base. 4) Desenhar na plantigrafia o calcâneo, a metade do calcâneo e traçar uma reta em direção aos metatarsos. 5) Desenhar a linha proximal da cabeça dos metatarsos 6) Desenhar os elementos na plantigrafia. 7) Com o auxílio de um estilete afiado, cortar o desenho dos elementos. 8) Desenhar o local dos elementos na placa base previamente cortada. 9)..."},{cap:"Confecção de Palmilha Moldada",txt:"10) Passar cola por cima dos elementos 11) Colar a cobertura sobre os elementos e inserir na termoprensa com a cobertura voltada para cima. 12) Segurar a termoprensa por aproximadamente 10s e deixar moldando por 3minutos à 80º. 13) Dar o acabamento necessário nas laterais da palmilha. CONFECÇÃO PALMILHA MOLDADA 1) Colar, com o soprador térmico, a placa de sustentação de arco plantar na placa base esportiva. O desenho do exemplo é um pé DIREITO. 2) Realizando o mesmo procedimento para confecção de palmilhas básicas, desenhar e colar (com soprador térmico) os elementos nesta placa base. 3) Passar cola em spray por cima dos elementos previamente posicionados"}] },
  { titulo:"Apostila Técnica Complementar", tipo:"Apostila", paginas:98, icon:"📘", cor:"#10B981", desc:"Material técnico de apoio com casos e procedimentos práticos.", conteudo:[{cap:"Material digitalizado",txt:"Esta apostila contém conteúdo digitalizado (imagens e diagramas). O material completo estará disponível para download quando o sistema for publicado com hospedagem de arquivos."}] },
  { titulo:"Cartilha de Protocolos de Tratamento", tipo:"Protocolo", paginas:34, icon:"📋", cor:"#F59E0B", desc:"Protocolos das patologias podais com prescrição de palmilha e exercícios.", conteudo:Object.entries(PROTOCOLOS_FP).slice(0,8).map(([n,p])=>({cap:n,txt:p.definicao+" Sintomas: "+p.sintomas+" Palmilha: "+(p.palmilha&&p.palmilha.elementos||"")+" Tratamento: "+p.tratamento})) },
  { titulo:"Guia de Elementos Posturais", tipo:"Guia", paginas:16, icon:"📐", cor:"#06B6D4", desc:"Referência rápida de barras, cunhas, botões e descargas.", conteudo:[{cap:"Barras",txt:"Barra retrocapital: posicionada atrás das cabeças dos metatarsos, usada na fascite plantar. Barra infracapital: sob as cabeças metatarsais, para neuroma de Morton e metatarsalgia. Barra subdigital: para dedos em garra."},{cap:"Cunhas",txt:"Cunha pronadora (medial): controla a supinação. Cunha supinadora (lateral): controla a pronação e estabiliza entorses. Geralmente 3-5° conforme avaliação."},{cap:"Descargas e Botões",txt:"Botão flexor: estímulo da musculatura intrínseca. Descarga em PORON: alívio de pressão em áreas de dor ou calosidade. Heel lift: elevação de calcâneo para tendinite de Aquiles."}] },
  { titulo:"Tecnologia FisioPiede — Palmilhas 3D em TPU", tipo:"Guia", paginas:8, icon:"🦿", cor:"#F59E0B", desc:"O processo exclusivo FisioPiede: avaliação, escaneamento 3D, modelagem digital e impressão em TPU de alta performance.", conteudo:[{cap:"Tecnologia em Palmilhas Posturais 3D",txt:"As palmilhas posturais 3D da FisioPiede representam uma evolução significativa na biomecânica aplicada ao tratamento fisioterapêutico. Todo o processo garante máxima precisão, personalização e eficiência clínica, unindo ciência, tecnologia e experiência clínica."},{cap:"1. Avaliação Biomecânica e Postural",txt:"O processo inicia com avaliação minuciosa do fisioterapeuta, que analisa postura, marcha, pisada e alterações biomecânicas. O profissional preenche um protocolo técnico exclusivo especificando necessidades terapêuticas e elementos corretivos. É feito o escaneamento 3D dos pés, capturando com precisão a anatomia plantar."},{cap:"2. Desenvolvimento Digital",txt:"Com os dados clínicos e o escaneamento 3D, a equipe usa software de última geração para modelagem biomecânica. A palmilha é construída digitalmente sobre o molde exato dos pés, com inserção precisa dos elementos corretivos. Cada correção é posicionada exatamente onde é necessária."},{cap:"3. Impressão 3D em TPU",txt:"Produzidas por impressão 3D em TPU (Poliuretano Termoplástico) de alta performance — importado, puro, flexível e resistente. Oferece alta durabilidade, memória elástica, conforto, resistência à deformação e absorção de impactos. A FisioPiede é pioneira no Brasil ao moldar os arcos anatômicos diretamente na impressão."},{cap:"4. Personalização Total",txt:"Cada palmilha é exclusiva, considerando anatomia plantar, alterações posturais, necessidades biomecânicas, objetivos terapêuticos e elementos prescritos. O resultado é uma órtese de alta precisão, com respostas mais rápidas, mais conforto e mais precisão — uma das soluções mais avançadas do mercado brasileiro."}] },
];


// ══════════════════════════════════════════════════════════════════════════════
// FISIOPIEDE MARKETING HUB — dados
// ══════════════════════════════════════════════════════════════════════════════
const MKT_CATEGORIAS = [
  { nome:"Fascite Plantar", icon:"🦶", cor:"#3B82F6" },
  { nome:"Esporão de Calcâneo", icon:"🦴", cor:"#A855F7" },
  { nome:"Neuroma de Morton", icon:"⚡", cor:"#8B5CF6" },
  { nome:"Metatarsalgia", icon:"⚠️", cor:"#EF4444" },
  { nome:"Pé Plano", icon:"🦶", cor:"#0EA5E9" },
  { nome:"Pé Cavo", icon:"👣", cor:"#14B8A6" },
  { nome:"Joanete", icon:"👣", cor:"#EC4899" },
  { nome:"Esporte e Corrida", icon:"🏃", cor:"#F97316" },
  { nome:"Qualidade de Vida", icon:"💚", cor:"#10B981" },
  { nome:"Postura", icon:"🧍", cor:"#6366F1" },
  { nome:"Tecnologia 3D", icon:"🦿", cor:"#F59E0B" },
];

// Posts prontos por categoria (legenda + hashtags + CTA)
const MKT_POSTS = {
  "Fascite Plantar": [
    { tipo:"Post", titulo:"Dor no calcanhar ao acordar?", legenda:"Aquela dor no calcanhar nos primeiros passos da manhã pode ser FASCITE PLANTAR. 🦶\n\nA boa notícia: tem tratamento! Com avaliação correta, exercícios e palmilhas posturais 3D, você volta a caminhar sem dor.\n\nAgende sua avaliação e dê o primeiro passo para viver sem dor. 👣", hashtags:"#fasciteplantar #dornocalcanhar #palmilhas #fisioterapia #saudedospes #qualidadedevida", cta:"Agende sua avaliação!" },
    { tipo:"Carrossel", titulo:"5 sinais de Fascite Plantar", legenda:"Será que é fascite plantar? Arraste e descubra os 5 sinais ➡️\n\n1️⃣ Dor no calcanhar ao acordar\n2️⃣ Dor que melhora ao caminhar e piora ao parar\n3️⃣ Rigidez na sola do pé\n4️⃣ Dor após ficar muito tempo em pé\n5️⃣ Desconforto ao subir escadas\n\nIdentificou? Procure avaliação especializada!", hashtags:"#fasciteplantar #saudedospes #fisioterapia #palmilhasposturais", cta:"Avalie seus pés conosco" },
  ],
  "Esporte e Corrida": [
    { tipo:"Post", titulo:"Corra mais, sinta menos", legenda:"Seus pés são a base de cada passada. 🏃‍♂️\n\nPalmilhas posturais 3D personalizadas melhoram seu desempenho, previnem lesões e dão mais conforto na corrida.\n\nInvista na sua performance do chão para cima!", hashtags:"#corrida #running #performance #palmilhas #prevencaodelesoes #corredores", cta:"Garanta sua avaliação de corredor" },
  ],
  "Qualidade de Vida": [
    { tipo:"Post", titulo:"Seus pés sustentam sua vida", legenda:"Cada passo importa. 💚\n\nPés saudáveis significam mais disposição, menos dores no corpo e mais qualidade de vida. Cuide da sua base!\n\nAvaliação completa + palmilhas posturais 3D personalizadas.", hashtags:"#qualidadedevida #saudedospes #bemestar #autocuidado #palmilhas", cta:"Cuide dos seus pés hoje" },
  ],
  "Tecnologia 3D": [
    { tipo:"Post", titulo:"Palmilhas 3D personalizadas em TPU", legenda:"Esqueça as palmilhas genéricas! 🦿\n\nAqui sua palmilha é feita SÓ PARA VOCÊ:\n📸 Escaneamento 3D dos seus pés\n💻 Modelagem digital com precisão milimétrica\n🖨️ Impressão em TPU de alta performance\n\nMais conforto, durabilidade e resultado terapêutico de verdade.", hashtags:"#palmilhas3d #tecnologia #tpu #impressao3d #fisioterapia #palmilhaspersonalizadas", cta:"Conheça nossa tecnologia" },
    { tipo:"Carrossel", titulo:"Como fazemos sua palmilha 3D", legenda:"Da avaliação à sua palmilha exclusiva, em 4 etapas ➡️\n\n1️⃣ Avaliação biomecânica e postural completa\n2️⃣ Escaneamento 3D dos seus pés\n3️⃣ Modelagem digital com seus elementos corretivos\n4️⃣ Impressão em TPU de alta performance\n\nPrecisão digital + ciência + personalização total. Pioneiros no Brasil em arcos moldados na impressão!", hashtags:"#palmilhas3d #tecnologia #biomecanica #fisioterapia #inovacao", cta:"Agende sua avaliação" },
    { tipo:"Post", titulo:"Por que TPU faz diferença", legenda:"Nossa palmilha é impressa em TPU de alta performance. Por que isso importa pra você? 🦿\n\n✅ Alta durabilidade\n✅ Memória elástica (não deforma)\n✅ Muito mais conforto\n✅ Absorve e dissipa impactos\n\nTecnologia de ponta a serviço dos seus pés.", hashtags:"#tpu #palmilhas3d #tecnologia #conforto #qualidade", cta:"Quero conhecer" },
  ],
};

// Campanhas sazonais e de captação
const MKT_CAMPANHAS = [
  { nome:"Tecnologia 3D Exclusiva", mes:"Ano todo", tipo:"Diferencial", icon:"🦿", cor:"#F59E0B", desc:"Mostre o diferencial tecnológico: escaneamento 3D, modelagem digital e impressão em TPU. Atrai pacientes que valorizam inovação e precisão.", copy:"Você sabia que a sua palmilha pode ser feita sob medida com tecnologia 3D? 🦿 Escaneamos seus pés, modelamos digitalmente e imprimimos em TPU de alta performance — precisão milimétrica e conforto que você sente desde o primeiro passo. Agende sua avaliação e conheça a palmilha do futuro!" },
  { nome:"Janeiro Branco", mes:"Janeiro", tipo:"Sazonal", icon:"🤍", cor:"#E2E8F0", desc:"Saúde mental e qualidade de vida começam pelo corpo. Campanha de bem-estar e cuidado integral.", copy:"Janeiro Branco 🤍 Cuidar da mente também é cuidar do corpo. Dores crônicas afetam seu bem-estar — comece o ano cuidando dos seus pés e da sua postura!" },
  { nome:"Verão Sem Dor", mes:"Dezembro-Fevereiro", tipo:"Sazonal", icon:"☀️", cor:"#F59E0B", desc:"Aproveite o verão caminhando, correndo e curtindo sem dores nos pés.", copy:"Verão chegando! ☀️ Não deixe a dor nos pés atrapalhar seus planos. Avaliação + palmilhas posturais para curtir a estação sem limites." },
  { nome:"Volta às Aulas", mes:"Fevereiro", tipo:"Sazonal", icon:"🎒", cor:"#3B82F6", desc:"Postura e pés saudáveis para crianças e adolescentes na volta às aulas.", copy:"Volta às aulas! 🎒 A postura do seu filho começa nos pés. Avaliação infantil para prevenir problemas posturais desde cedo." },
  { nome:"Dia das Mães", mes:"Maio", tipo:"Sazonal", icon:"💐", cor:"#EC4899", desc:"Presenteie quem cuida de todos com saúde e conforto.", copy:"Dia das Mães 💐 Presenteie com saúde e bem-estar! Avaliação + palmilhas posturais: o presente que ela merece para viver sem dores." },
  { nome:"Black Friday", mes:"Novembro", tipo:"Promocional", icon:"🛍️", cor:"#18181B", desc:"Maior promoção do ano em avaliações e palmilhas posturais.", copy:"BLACK FRIDAY FISIOPIEDE 🛍️ Condições especiais em avaliação + palmilhas posturais 3D. Vagas limitadas! Agende já e invista na sua saúde." },
  { nome:"Campanha do Corredor", mes:"Ano todo", tipo:"Captação", icon:"🏃", cor:"#F97316", desc:"Foco em corredores e praticantes de atividade física.", copy:"Corredor! 🏃 Melhore sua performance e previna lesões com palmilhas posturais 3D feitas para seu tipo de pisada. Avaliação especializada para atletas." },
  { nome:"Campanha do Idoso", mes:"Ano todo", tipo:"Captação", icon:"👴", cor:"#14B8A6", desc:"Equilíbrio, segurança e prevenção de quedas para a terceira idade.", copy:"Mais segurança a cada passo 👴 Palmilhas posturais melhoram o equilíbrio e previnem quedas. Cuide de quem você ama com avaliação especializada." },
  { nome:"Indique um Amigo", mes:"Ano todo", tipo:"Indicação", icon:"🤝", cor:"#8B5CF6", desc:"Programa de indicação com benefícios para quem indica e quem é indicado.", copy:"Indique um amigo e ganhe! 🤝 Quem você ama também merece viver sem dores. Indique e ambos ganham benefícios exclusivos na avaliação." },
];

// Calendário de marketing — datas comemorativas relevantes
const MKT_CALENDARIO = [
  { mes:"Janeiro", datas:[{d:"Mês todo",ev:"Janeiro Branco — saúde mental"},{d:"Verão",ev:"Campanha Verão Sem Dor"}] },
  { mes:"Fevereiro", datas:[{d:"Início",ev:"Volta às aulas — postura infantil"},{d:"Carnaval",ev:"Pés prontos para folia"}] },
  { mes:"Março", datas:[{d:"08/03",ev:"Dia da Mulher — saúde feminina"},{d:"Outono",ev:"Transição de estação"}] },
  { mes:"Abril", datas:[{d:"07/04",ev:"Dia Mundial da Saúde"},{d:"Mês",ev:"Atividade física"}] },
  { mes:"Maio", datas:[{d:"2º domingo",ev:"Dia das Mães 💐"},{d:"Mês",ev:"Campanha de avaliação"}] },
  { mes:"Junho", datas:[{d:"Inverno",ev:"Campanha Inverno — conforto"},{d:"Festa Junina",ev:"Pés prontos para dançar"}] },
  { mes:"Julho", datas:[{d:"Férias",ev:"Avaliação infantil de férias"}] },
  { mes:"Agosto", datas:[{d:"2º domingo",ev:"Dia dos Pais 👔"},{d:"Mês",ev:"Saúde masculina"}] },
  { mes:"Setembro", datas:[{d:"Primavera",ev:"Renovação e bem-estar"},{d:"Mês",ev:"Campanha de corrida"}] },
  { mes:"Outubro", datas:[{d:"Mês",ev:"Outubro — autocuidado"},{d:"Corridas",ev:"Temporada de corridas"}] },
  { mes:"Novembro", datas:[{d:"Última 6ª",ev:"Black Friday 🛍️"},{d:"Mês",ev:"Maior promoção do ano"}] },
  { mes:"Dezembro", datas:[{d:"25/12",ev:"Natal — presente de saúde"},{d:"Verão",ev:"Pés prontos para o verão"}] },
];

const STATUS_FLOW = ["Recebido","Analisando","Em Produção","Impressão 3D","Acabamento","Enviado","Finalizado"];
const STATUS_CFG = {
  "Recebido":    {color:"#64748B",icon:"📥"},
  "Analisando":  {color:"#F59E0B",icon:"🔍"},
  "Em Produção": {color:"#8B5CF6",icon:"⚙️"},
  "Impressão 3D":{color:"#3B82F6",icon:"🖨️"},
  "Acabamento":  {color:"#EC4899",icon:"✨"},
  "Enviado":     {color:"#10B981",icon:"🚚"},
  "Finalizado":  {color:"#10B981",icon:"✅"},
};

const CLINICAS_INIT = [];

const PEDIDOS_INIT = [];

const PACIENTES_INIT = [];

const PRONT = {};

const brl  = v => Number(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
// Recibo de pagamento em PDF (com a marca FisioPiede). Reutilizado no fechamento e na assinatura.
function gerarReciboPDF({ clinica, descricao, valor, forma, data }){
  const esc=(s)=>String(s==null?"":s);
  const hoje = data || new Date().toLocaleDateString("pt-BR");
  const num = "REC-" + Date.now().toString(36).toUpperCase();
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Recibo ${esc(num)}</title>
    <style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0F172A;font-size:13px;line-height:1.6;}
    .wrap{max-width:720px;margin:0 auto;padding:42px 46px;}
    .top{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:18px;border-bottom:3px solid #3B82F6;}
    .marca{font-size:27px;font-weight:800;color:#3B82F6;letter-spacing:-.5px;line-height:1;}.marca span{color:#0F172A;}
    .sub{font-size:10px;color:#64748B;letter-spacing:.12em;margin-top:4px;font-weight:700;}
    .meta{text-align:right;font-size:12px;color:#475569;}
    .titulo{font-size:22px;font-weight:800;letter-spacing:.06em;margin:24px 0 4px;}
    .valorbox{background:linear-gradient(135deg,#3B82F6,#6366F1);color:#fff;border-radius:12px;padding:18px 22px;margin:16px 0;display:flex;justify-content:space-between;align-items:center;}
    .valorbox small{font-size:10px;opacity:.85;text-transform:uppercase;letter-spacing:.08em;}
    .valorbox b{font-size:28px;}
    .linha{display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid #EEF2F6;}
    .linha span:first-child{color:#64748B;font-weight:600;}
    .corpo{margin:18px 0;font-size:14px;line-height:1.8;}
    .ass{margin-top:54px;display:flex;justify-content:center;}
    .ass div{text-align:center;border-top:1px solid #475569;padding-top:7px;width:300px;font-size:12px;color:#475569;}
    .foot{margin-top:26px;border-top:1px solid #E2E8F0;padding-top:13px;font-size:10px;color:#94A3B8;text-align:center;}
    @media print{.wrap{padding:24px 26px;}button{display:none;}}</style></head><body><div class="wrap">
    <div class="top"><div><div class="marca">Fisio<span>Piede</span></div><div class="sub">HEALTH TECH PLATFORM</div></div>
    <div class="meta">Recibo nº ${esc(num)}<br>${esc(hoje)}</div></div>
    <div class="titulo">RECIBO</div>
    <div class="valorbox"><small>Valor recebido</small><b>R$ ${brl(valor)}</b></div>
    <div class="corpo">Recebemos de <b>${esc(clinica||"—")}</b> a importância de <b>R$ ${brl(valor)}</b>, referente a <b>${esc(descricao||"—")}</b>.</div>
    <div class="linha"><span>Pagador</span><span>${esc(clinica||"—")}</span></div>
    <div class="linha"><span>Referente a</span><span>${esc(descricao||"—")}</span></div>
    <div class="linha"><span>Forma de pagamento</span><span>${esc(forma||"—")}</span></div>
    <div class="linha"><span>Data</span><span>${esc(hoje)}</span></div>
    <div class="ass"><div>FisioPiede Health Tech Platform</div></div>
    <div class="foot">Documento gerado eletronicamente pelo sistema FisioPiede • Recibo nº ${esc(num)}</div>
    </div><script>window.onload=function(){setTimeout(function(){window.print();},350);};<\/script></body></html>`;
  const w = window.open("","_blank"); if(!w){ alert("Permita pop-ups para gerar o recibo."); return; }
  w.document.open(); w.document.write(html); w.document.close();
}
const fmtD = iso => iso ? iso.split("-").reverse().join("/") : "—";
const nowTs = () => { const n=new Date(); return `${String(n.getDate()).padStart(2,"0")}/${String(n.getMonth()+1).padStart(2,"0")} ${String(n.getHours()).padStart(2,"0")}:${String(n.getMinutes()).padStart(2,"0")}`; };

// ─── STYLES ────────────────────────────────────────────────────────────────────
function useIsMobile(bp){
  const breakpoint = bp || 760;
  const get = () => (typeof window!=="undefined" ? window.innerWidth <= breakpoint : false);
  const [m,setM] = useState(get);
  useEffect(()=>{
    const onR = () => setM(get());
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  },[]);
  return m;
}

function GS() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,600;9..40,700;9..40,800;9..40,900&family=Space+Mono:wght@400;700&display=swap');
      *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
      html,body{background:#06080D;color:#F1F5F9;font-family:'DM Sans',sans-serif;overflow-x:hidden}
      ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:transparent}
      ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.07);border-radius:99px}
      @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
      @keyframes fadeIn{from{opacity:0}to{opacity:1}}
      @keyframes spin{to{transform:rotate(360deg)}}
      @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
      @keyframes drift{0%{opacity:.5;transform:translateY(0)}50%{opacity:.8;transform:translateY(-50px)}100%{opacity:0;transform:translateY(-100px)}}
      @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
      @keyframes ping{0%{transform:scale(1);opacity:1}75%,100%{transform:scale(2.2);opacity:0}}
      @keyframes logoIn{from{clip-path:inset(0 100% 0 0);opacity:0}to{clip-path:inset(0 0 0 0);opacity:1}}
      @keyframes scaleIn{from{opacity:0;transform:scale(.96) translateY(8px)}to{opacity:1;transform:scale(1) translateY(0)}}
      @keyframes shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}
      @keyframes glowPulse{0%,100%{box-shadow:0 0 0 0 rgba(59,130,246,0)}50%{box-shadow:0 0 0 4px rgba(59,130,246,.12)}}
      button:active:not(:disabled){filter:brightness(1.12)}
      button{transition:filter .12s,transform .15s,background .18s}
      tbody tr{transition:background .14s}
      tbody tr:hover{background:rgba(255,255,255,.025)}
      a{transition:color .15s,opacity .15s}
      input,textarea,select{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);color:#F1F5F9;font-family:'DM Sans',sans-serif;font-size:14px;border-radius:10px;padding:10px 13px;width:100%;outline:none;transition:border-color .18s,box-shadow .18s}
      input:focus,textarea:focus,select:focus{border-color:#3B82F6;box-shadow:0 0 0 3px rgba(59,130,246,.2)}
      input::placeholder,textarea::placeholder{color:#475569}
      button{cursor:pointer;font-family:'DM Sans',sans-serif;border:none;outline:none}
      select option{background:#0B0E15}
      label{font-size:11px;color:#475569;display:block;margin-bottom:5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase}
    `}</style>
  );
}

function GridBg() {
  return <div style={{position:"fixed",inset:0,zIndex:0,pointerEvents:"none",backgroundImage:"linear-gradient(rgba(59,130,246,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(59,130,246,.025) 1px,transparent 1px)",backgroundSize:"52px 52px"}}/>;
}

function Particles() {
  const pts = useRef(
    Array.from({length:20},(_,i)=>({id:i,x:Math.random()*100,y:Math.random()*100,s:Math.random()*2+.8,delay:Math.random()*10,dur:Math.random()*7+6,c:[C.accent,C.purple,C.green,"#fff"][Math.floor(Math.random()*4)]}))
  ).current;
  return (
    <div style={{position:"absolute",inset:0,overflow:"hidden",pointerEvents:"none"}}>
      {pts.map(p => (
        <div key={p.id} style={{position:"absolute",left:`${p.x}%`,top:`${p.y}%`,width:p.s,height:p.s,borderRadius:"50%",background:p.c,opacity:0,animation:`drift ${p.dur}s ${p.delay}s ease-in-out infinite`,boxShadow:`0 0 ${p.s*3}px ${p.c}`}}/>
      ))}
    </div>
  );
}

function Card({children,style={},hover=true,onClick,p=20}) {
  const [h,setH] = useState(false);
  return (
    <div onClick={onClick} onMouseEnter={()=>hover&&setH(true)} onMouseLeave={()=>hover&&setH(false)}
      style={{background:h?"rgba(255,255,255,.05)":C.bgGlass,border:`1px solid ${h?C.borderH:C.border}`,borderRadius:16,backdropFilter:"blur(14px)",transition:"all .2s",transform:h?"translateY(-2px)":"none",boxShadow:h?`0 12px 40px rgba(0,0,0,.5),0 0 0 1px ${C.glow}`:"0 4px 20px rgba(0,0,0,.2)",cursor:onClick?"pointer":"default",padding:p,...style}}>
      {children}
    </div>
  );
}

function Btn({children,v="primary",onClick,style={},disabled=false,sz="md",full=false}) {
  const [h,setH] = useState(false);
  const pad = sz==="sm"?"7px 14px":sz==="lg"?"13px 28px":"10px 20px";
  const fs  = sz==="sm"?12:sz==="lg"?15:14;
  const variants = {
    primary:{background:h?`linear-gradient(135deg,#2563EB,${C.accent})`:`linear-gradient(135deg,${C.accent},#2563EB)`,color:"#fff",boxShadow:h?`0 6px 22px ${C.accent}55, inset 0 1px 0 rgba(255,255,255,.22)`:`0 3px 12px ${C.accent}33, inset 0 1px 0 rgba(255,255,255,.18)`},
    ghost:  {background:h?"rgba(255,255,255,.06)":"transparent",color:h?"#fff":C.sub,border:`1px solid ${C.border}`},
    danger: {background:h?"#DC2626":C.red,color:"#fff",boxShadow:h?`0 4px 16px ${C.red}44`:"none"},
    success:{background:h?"#059669":C.green,color:"#fff",boxShadow:h?`0 4px 16px ${C.green}44`:"none"},
    outline:{background:h?`${C.accent}10`:"transparent",color:C.soft,border:`1px solid ${C.accent}`,boxShadow:h?`0 0 14px ${C.glow}`:"none"},
    gold:   {background:h?"#D97706":C.gold,color:"#000",fontWeight:800,boxShadow:h?`0 4px 16px ${C.gold}44`:"none"},
    subtle: {background:h?"rgba(255,255,255,.05)":"rgba(255,255,255,.02)",color:C.sub,border:`1px solid ${C.border}`},
  };
  return (
    <button disabled={disabled} onClick={onClick} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)}
      style={{padding:pad,fontSize:fs,fontWeight:600,borderRadius:11,transition:"all .18s cubic-bezier(.4,0,.2,1)",opacity:disabled?.5:1,transform:(h&&!disabled)?"translateY(-1px)":"none",display:"inline-flex",alignItems:"center",gap:6,width:full?"100%":"auto",justifyContent:full?"center":"flex-start",...(variants[v]||variants.primary),...style}}>
      {children}
    </button>
  );
}

function Badge({label,color=C.accent}) {
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:5,background:`${color}18`,border:`1px solid ${color}30`,color,borderRadius:99,padding:"3px 10px",fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>
      <span style={{width:5,height:5,borderRadius:"50%",background:color,flexShrink:0}}/>{label}
    </span>
  );
}

function SBadge({status}) {
  const s = STATUS_CFG[status]||{color:C.sub,icon:"•"};
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:5,background:`${s.color}14`,border:`1px solid ${s.color}30`,color:s.color,borderRadius:99,padding:"4px 10px",fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>
      <span style={{fontSize:10}}>{s.icon}</span>{status}
    </span>
  );
}

function Spin({sz=16,color=C.accent}) {
  return <span style={{width:sz,height:sz,border:`2px solid ${color}25`,borderTop:`2px solid ${color}`,borderRadius:"50%",animation:"spin .8s linear infinite",display:"inline-block",flexShrink:0}}/>;
}

function ANum({value,prefix=""}) {
  const [d,setD] = useState(0);
  useEffect(()=>{
    const t = parseFloat(String(value).replace(/[^\d.]/g,""))||0;
    let s=0, step=t/45;
    const iv = setInterval(()=>{ s+=step; if(s>=t){setD(t);clearInterval(iv);}else setD(s); },22);
    return ()=>clearInterval(iv);
  },[value]);
  return <span>{prefix}{Math.round(d).toLocaleString("pt-BR")}</span>;
}

function Spark({data,color=C.accent,w=80,h=28}) {
  const id = useRef(`sk_${Math.random().toString(36).slice(2)}`).current;
  const max=Math.max(...data), min=Math.min(...data);
  const pts = data.map((v,i)=>`${(i/(data.length-1))*w},${h-((v-min)/(max-min||1))*h}`).join(" ");
  return (
    <svg width={w} height={h} style={{overflow:"visible"}}>
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".3"/><stop offset="100%" stopColor={color} stopOpacity="0"/></linearGradient></defs>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill={`url(#${id})`}/>
    </svg>
  );
}

function Bars({data,color=C.accent,labels,h=80}) {
  const max = Math.max(...data)||1;
  return (
    <div style={{display:"flex",alignItems:"flex-end",gap:5,height:h}}>
      {data.map((v,i)=>(
        <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
          <div style={{flex:1,width:"100%",display:"flex",alignItems:"flex-end"}}>
            <div style={{width:"100%",height:`${(v/max)*100}%`,background:`linear-gradient(to top,${color},${color}70)`,borderRadius:"4px 4px 0 0",transition:"height 1.2s",boxShadow:`0 0 8px ${color}35`}}/>
          </div>
          {labels&&<span style={{fontSize:8,color:C.muted}}>{labels[i]}</span>}
        </div>
      ))}
    </div>
  );
}

function Donut({segs,size=90,label}) {
  const total = segs.reduce((a,s)=>a+s.v,0)||1;
  let cum = -90;
  const cx=size/2,cy=size/2,r=size*.37,sw=size*.13;
  const xy = a => [cx+r*Math.cos(a*Math.PI/180), cy+r*Math.sin(a*Math.PI/180)];
  return (
    <svg width={size} height={size}>
      {segs.map((s,i)=>{
        const a=(s.v/total)*360;
        const [x1,y1]=xy(cum); const [x2,y2]=xy(cum+a);
        const lg=a>180?1:0;
        const d=`M${x1} ${y1} A${r} ${r} 0 ${lg} 1 ${x2} ${y2}`;
        cum+=a;
        return <path key={i} d={d} fill="none" stroke={s.c} strokeWidth={sw} strokeLinecap="round" style={{filter:`drop-shadow(0 0 4px ${s.c}40)`}}/>;
      })}
      {label&&<text x={cx} y={cy+5} textAnchor="middle" fill={C.text} fontSize={size*.13} fontWeight="900" fontFamily="DM Sans">{label}</text>}
    </svg>
  );
}

function MCard({label,value,prefix="",icon,color=C.accent,change,spark,delay=0}) {
  return (
    <Card style={{padding:0,animation:`fadeUp .5s ${delay}s ease both`,opacity:0,overflow:"hidden",position:"relative"}}>
      {/* faixa de cor no topo */}
      <div style={{height:3,background:`linear-gradient(90deg,${color},${color}55)`}}/>
      {/* brilho sutil no canto */}
      <div style={{position:"absolute",top:-30,right:-30,width:90,height:90,borderRadius:"50%",background:`radial-gradient(circle,${color}14,transparent 70%)`,pointerEvents:"none"}}/>
      <div style={{padding:18}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
          <div style={{width:40,height:40,borderRadius:12,background:`linear-gradient(135deg,${color}22,${color}0C)`,border:`1px solid ${color}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,boxShadow:`0 4px 14px ${color}18`}}>{icon}</div>
          {spark&&<Spark data={spark} color={color}/>}
        </div>
        <div style={{fontSize:26,fontWeight:900,marginBottom:3,letterSpacing:"-.5px",textShadow:`0 0 20px ${color}25`}}><ANum value={value} prefix={prefix}/></div>
        <div style={{fontSize:11.5,color:C.sub,fontWeight:500}}>{label}</div>
        {change!==undefined&&<div style={{fontSize:11,color:change>=0?C.green:C.red,fontWeight:600,marginTop:5}}>{change>=0?"▲":"▼"} {Math.abs(change)}% vs mês anterior</div>}
      </div>
    </Card>
  );
}

function SH({title,sub,right}) {
  return (
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
      <div><div style={{fontSize:19,fontWeight:900}}>{title}</div>{sub&&<div style={{fontSize:12,color:C.muted,marginTop:3}}>{sub}</div>}</div>
      {right&&<div style={{display:"flex",gap:8,alignItems:"center"}}>{right}</div>}
    </div>
  );
}

function Modal({children,onClose}) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",backdropFilter:"blur(10px)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",animation:"fadeIn .2s ease",padding:14}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      {children}
    </div>
  );
}

// ─── NAV DATA ──────────────────────────────────────────────────────────────────
const NAV_ADMIN   = [{id:"dashboard",icon:"⬡",label:"Dashboard"},{id:"clinicas",icon:"🏥",label:"Clínicas"},{id:"pedidos",icon:"📦",label:"Pedidos"},{id:"producao",icon:"⚙️",label:"Produção"},{id:"financeiro",icon:"💳",label:"Financeiro"},{id:"fechamento",icon:"📋",label:"Fechamento"},{id:"notificacoes",icon:"🔔",label:"Notificações"},{id:"agenda",icon:"📅",label:"Agenda"},{id:"pacientes",icon:"👤",label:"Pacientes"},{id:"ia",icon:"✦",label:"IA Clínica"},{id:"relatorios",icon:"📊",label:"Relatórios"},{id:"academy",icon:"🎓",label:"Academy"},{id:"marketing",icon:"📣",label:"Marketing"},{id:"config",icon:"⚙",label:"Config"}];
const NAV_CLINICA = [{id:"dashboard",icon:"⬡",label:"Dashboard"},{id:"pedidos",icon:"📦",label:"Meus Pedidos"},{id:"avaliacao",icon:"🩺",label:"Avaliação"},{id:"pacientes",icon:"👤",label:"Pacientes"},{id:"agenda",icon:"📅",label:"Agenda"},{id:"mensagens",icon:"💬",label:"Mensagens"},{id:"financeiro",icon:"💳",label:"Financeiro"},{id:"ia",icon:"✦",label:"IA"},{id:"academy",icon:"🎓",label:"Academy"},{id:"marketing",icon:"📣",label:"Marketing"},{id:"config",icon:"⚙",label:"Config"}];
const NAV_PACIENTE = [{id:"dashboard",icon:"⬡",label:"Meu Painel"},{id:"patologia",icon:"🩺",label:"Minha Patologia"},{id:"exercicios",icon:"💪",label:"Exercícios"},{id:"mensagens",icon:"💬",label:"Mensagens"},{id:"config",icon:"⚙",label:"Meu Perfil"}];
const NAV_PAC     = [{id:"dashboard",icon:"⬡",label:"Meu Painel"},{id:"palmilha",icon:"🦶",label:"Minha Palmilha"},{id:"exercicios",icon:"💪",label:"Exercícios"},{id:"agenda",icon:"📅",label:"Consultas"},{id:"mensagens",icon:"💬",label:"Mensagens"}];

function Sidebar({nav,active,setActive,userType,userName,onLogout,plano,bloqueados,isMobile,mobileOpen,onCloseMobile,badges}) {
  const bloq = bloqueados || [];
  const [col,setCol] = useState(false);
  // No celular nunca usa modo "colapsado" (estreito); usa drawer cheio
  const colapsado = isMobile ? false : col;
  const handleNav = (id) => { setActive(id); if(isMobile && onCloseMobile) onCloseMobile(); };
  const tc = userType==="admin"?C.accent:userType==="clinica"?C.green:userType==="colaborador"?C.accent:C.purple;
  const tl = userType==="admin"?"Admin Master":userType==="clinica"?"Clínica":userType==="colaborador"?"Colaborador":"Paciente";
  return (
    <>
    {isMobile && mobileOpen && <div onClick={onCloseMobile} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.55)",zIndex:199}}/>}
    <div style={isMobile
      ? {width:250,height:"100vh",background:C.bgCard,borderRight:`1px solid ${C.border}`,display:"flex",flexDirection:"column",position:"fixed",top:0,left:0,zIndex:200,transform:mobileOpen?"translateX(0)":"translateX(-105%)",transition:"transform .25s ease",boxShadow:mobileOpen?"4px 0 24px rgba(0,0,0,.4)":"none"}
      : {width:colapsado?58:218,minHeight:"100vh",background:C.bgCard,borderRight:`1px solid ${C.border}`,display:"flex",flexDirection:"column",transition:"width .25s",position:"sticky",top:0,flexShrink:0,zIndex:100}}>
      <div style={{padding:colapsado?"15px 0":"15px 16px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:colapsado?"center":"space-between",gap:8}}>
        {!colapsado&&<div style={{display:"flex",alignItems:"center",gap:9,minWidth:0}}><div style={{width:32,height:32,borderRadius:9,background:`linear-gradient(135deg,${C.accent},${C.purple})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0,boxShadow:`0 2px 10px ${C.accent}33`}}>🦶</div><div style={{minWidth:0}}><div style={{fontWeight:900,fontSize:15,lineHeight:1.05}}>Fisio<span style={{color:C.accent}}>Piede</span></div><div style={{fontSize:7,color:C.sub,letterSpacing:".14em",fontWeight:700,marginTop:1}}>HEALTH TECH PLATFORM</div>{userType==="clinica"&&userName&&<div style={{fontSize:9.5,color:C.green,fontWeight:600,marginTop:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>🏥 {userName}</div>}</div></div>}
        {colapsado&&<div style={{width:28,height:28,borderRadius:8,background:`linear-gradient(135deg,${C.accent},${C.purple})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>🦶</div>}
        {!isMobile && <button onClick={()=>setCol(!col)} style={{background:"none",color:C.muted,fontSize:12,padding:"3px 5px",borderRadius:5}}>{colapsado?"›":"‹"}</button>}
        {isMobile && <button onClick={onCloseMobile} style={{background:"none",color:C.muted,fontSize:20,padding:"0 4px"}}>✕</button>}
      </div>
      {!colapsado&&<div style={{padding:"7px 13px",display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}><span style={{fontSize:9,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:tc,background:`${tc}14`,padding:"3px 8px",borderRadius:4}}>{tl}</span>{userType==="clinica"&&plano&&<span style={{fontSize:9,fontWeight:700,textTransform:"uppercase",color:plano==="Enterprise"?C.gold:plano==="Premium"?C.purple:C.muted,background:`${plano==="Enterprise"?C.gold:plano==="Premium"?C.purple:C.muted}14`,padding:"3px 8px",borderRadius:4}}>{plano==="Enterprise"?"👑 ":plano==="Premium"?"💎 ":""}{plano}</span>}</div>}
      <nav style={{flex:1,padding:"5px 0",overflowY:"auto"}}>
        {nav.map(item=>{
          const a = active===item.id;
          const isBloq = bloq.includes(item.id);
          return (
            <button key={item.id} onClick={()=>handleNav(item.id)} title={isBloq?"Recurso bloqueado — faça upgrade do plano":item.label} style={{width:"100%",display:"flex",alignItems:"center",gap:10,padding:colapsado?"10px 0":"10px 13px",justifyContent:colapsado?"center":"flex-start",background:a?`${C.accent}13`:"transparent",color:isBloq?C.muted+"99":(a?C.soft:C.muted),fontSize:13,fontWeight:a?600:400,borderLeft:a?`2px solid ${C.accent}`:"2px solid transparent",transition:"all .13s",opacity:isBloq?0.78:1}}>
              <span style={{fontSize:15,position:"relative"}}>{isBloq?"🔒":item.icon}{colapsado&&!isBloq&&badges&&badges[item.id]>0&&<span style={{position:"absolute",top:-5,right:-7,minWidth:14,height:14,borderRadius:99,background:C.red,color:"#fff",fontSize:8,fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 3px"}}>{badges[item.id]>9?"9+":badges[item.id]}</span>}</span>{!colapsado&&<span style={{flex:1,textAlign:"left"}}>{item.label}</span>}{!colapsado&&isBloq&&<span style={{fontSize:8,fontWeight:800,color:C.purple,background:`${C.purple}1a`,padding:"2px 5px",borderRadius:4,textTransform:"uppercase",letterSpacing:".03em"}}>PRO</span>}{!colapsado&&!isBloq&&badges&&badges[item.id]>0&&<span style={{fontSize:9,fontWeight:900,color:"#fff",background:C.red,minWidth:17,height:17,borderRadius:99,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 5px"}}>{badges[item.id]>99?"99+":badges[item.id]}</span>}
            </button>
          );
        })}
      </nav>
      <div style={{padding:colapsado?"10px 0":"10px 13px",borderTop:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:8,justifyContent:colapsado?"center":"flex-start"}}>
        <div style={{width:26,height:26,borderRadius:"50%",background:`linear-gradient(135deg,${tc},${C.purple})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:900,flexShrink:0}}>{(userName||"U").charAt(0)}</div>
        {!colapsado&&<div style={{flex:1,minWidth:0}}><div style={{fontSize:11,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{userName}</div><button onClick={onLogout} style={{background:"none",color:C.muted,fontSize:10,padding:0}}>Sair →</button></div>}
      </div>
    </div>
    </>
  );
}

function Topbar({title,sub,onLogout,clinicaName,isAdmin,notifDestino,onMenu,isMobile,onNavegar}) {
  return (
    <div style={{height:56,borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",padding:isMobile?"0 12px":"0 20px",background:`${C.bgCard}dd`,backdropFilter:"blur(14px)",position:"sticky",top:0,zIndex:50}}>
      <div style={{display:"flex",alignItems:"center",gap:isMobile?8:12,minWidth:0}}>
        {isMobile&&<button onClick={onMenu} style={{background:"none",color:C.text,fontSize:22,padding:"2px 6px",flexShrink:0}}>☰</button>}
        {!isMobile&&!isAdmin&&clinicaName&&<div style={{padding:"3px 10px",background:`${C.green}14`,border:`1px solid ${C.green}30`,borderRadius:99,fontSize:10,fontWeight:700,color:C.green}}>🏥 {clinicaName}</div>}
        {!isMobile&&isAdmin&&<div style={{padding:"3px 10px",background:`${C.accent}14`,border:`1px solid ${C.accent}30`,borderRadius:99,fontSize:10,fontWeight:700,color:C.accent}}>⚡ Admin Master</div>}
        <div style={{minWidth:0}}><div style={{fontWeight:800,fontSize:14,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{title}</div>{sub&&!isMobile&&<div style={{fontSize:11,color:C.muted}}>{sub}</div>}</div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
        {!isMobile&&<span style={{fontSize:11,color:C.muted,display:"flex",alignItems:"center",gap:5}}><span style={{width:6,height:6,borderRadius:"50%",background:C.green,display:"inline-block"}}/>Online</span>}
        {notifDestino&&<NotifBell destino={notifDestino} onNavegar={onNavegar}/>}
        {!isMobile&&<Btn v="ghost" sz="sm" onClick={onLogout}>Sair</Btn>}
      </div>
    </div>
  );
}

// ─── SPLASH ────────────────────────────────────────────────────────────────────
function Splash({onDone}) {
  const [prog,setProg] = useState(0);
  useEffect(()=>{
    const t = setInterval(()=>setProg(p=>{ if(p>=100){clearInterval(t);setTimeout(onDone,400);return 100;} return p+1.8; }),30);
    return ()=>clearInterval(t);
  },[]);
  const msg = prog<25?"Inicializando sistema...":prog<55?"Carregando módulos clínicos...":prog<80?"Conectando servidores AWS...":prog<95?"Validando segurança...":"Pronto!";
  return (
    <div style={{position:"fixed",inset:0,background:C.bg,zIndex:9999,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
      <Particles/><GridBg/>
      <div style={{position:"relative",zIndex:1,textAlign:"center"}}>
        <div style={{position:"relative",width:96,height:96,margin:"0 auto 26px"}}>
          <div style={{position:"absolute",inset:-18,borderRadius:"50%",background:`radial-gradient(circle,${C.glow} 0%,transparent 70%)`,animation:"float 4s ease-in-out infinite"}}/>
          <div style={{width:96,height:96,borderRadius:26,background:`linear-gradient(135deg,${C.accent},${C.purple})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:46,boxShadow:`0 0 60px ${C.glow}`,animation:"float 4s ease-in-out infinite"}}>🦶</div>
        </div>
        <div style={{fontSize:36,fontWeight:900,letterSpacing:"-.04em",animation:"logoIn 1s .3s ease both",clipPath:"inset(0 100% 0 0)"}}>Fisio<span style={{color:C.accent}}>Piede</span></div>
        <div style={{fontSize:11,color:C.muted,marginTop:6,letterSpacing:".12em",textTransform:"uppercase"}}>Health Tech Platform</div>
        <div style={{width:250,margin:"28px auto 0"}}>
          <div style={{height:2,background:C.border,borderRadius:99,overflow:"hidden",marginBottom:8}}>
            <div style={{height:"100%",width:`${prog}%`,background:`linear-gradient(90deg,${C.accent},${C.purple})`,transition:"width .03s linear"}}/>
          </div>
          <div style={{fontSize:10,color:C.muted,fontFamily:"'Space Mono',monospace"}}>{msg}</div>
        </div>
      </div>
    </div>
  );
}

// ─── LOGIN ─────────────────────────────────────────────────────────────────────
function Login({onLogin,clinicas,pacientes}) {
  const [email,setEmail] = useState("");
  const [pass,setPass]   = useState("");
  // Indicação Elite via link mágico (?ref=ELITE-XXXXXX) — código travado, não editável
  const [refIndicacao] = useState(()=>{
    try {
      const p = new URLSearchParams(window.location.search).get("ref") || "";
      const cod = p.trim().toUpperCase();
      return /^ELITE-[A-Z0-9]{1,6}$/.test(cod) ? cod : "";
    } catch(e){ return ""; }
  });
  const clinicaIndicadora = refIndicacao
    ? ((clinicas||[]).find(c=>("ELITE-"+(c.nome||"").replace(/[^A-Za-z0-9]/g,"").slice(0,6).toUpperCase())===refIndicacao) || null)
    : null;
  // Página pública "Encontre uma clínica" — abre direto via fisio-piede.vercel.app/?encontre
  const [modoEncontre] = useState(()=>{ try { return new URLSearchParams(window.location.search).has("encontre"); } catch(e){ return false; } });
  const [mode,setMode]   = useState(refIndicacao ? "access" : (modoEncontre ? "encontre" : "login"));
  const [buscaCli,setBuscaCli] = useState("");
  const [ufCli,setUfCli] = useState("");
  const [loading,setLoading] = useState(false);
  const [showP,setShowP] = useState(false);
  const [sent,setSent]   = useState(false);
  const [err,setErr]     = useState("");
  const [solic,setSolic] = useState({clinica:"",cnpj:"",cpf:"",responsavel:"",telefone:"",email:"",cep:"",rua:"",numero:"",complemento:"",bairro:"",cidade:"",estado:""});

  const enviarSolicitacao = () => {
    if(!solic.clinica.trim()||!solic.email.trim()){ setErr("Preencha ao menos o nome da clínica e o e-mail."); return; }
    setErr("");
    try {
      const lista = LS.read("fp:solicitacoes") || [];
      LS.write("fp:solicitacoes", [{...solic, indicadoPor: refIndicacao || undefined, indicadoPorNome: (clinicaIndicadora && clinicaIndicadora.nome) || undefined, id:Date.now(), data:new Date().toISOString(), status:"Pendente"}, ...lista]);
      pushNotif("admin:master", "📩", "Nova solicitação de acesso", `${solic.clinica} (${solic.cidade||"—"}) solicitou licença.${refIndicacao ? " 👑 Indicado por: "+((clinicaIndicadora&&clinicaIndicadora.nome)||refIndicacao)+"." : ""}`, "clinicas");
    } catch(e){}
    setSent(true);
  };

  // 🔐 SEGURANÇA: a senha do Admin Master NÃO vive mais no código do app.
  // A verificação é feita no servidor (api/login-admin.js), que lê as
  // variáveis de ambiente ADMIN_EMAIL e ADMIN_PASS configuradas na Vercel.

  const handle = () => {
    if(!email.trim()||!pass.trim()){setErr("Preencha e-mail e senha.");return;}
    setErr(""); setLoading(true);
    setTimeout(async ()=>{
      // Admin master — verificação no SERVIDOR
      let adminCfgPendente = false;
      try {
        const r = await fetch("/api/login-admin",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:email.trim(),senha:pass})});
        const d = await r.json().catch(()=>null);
        if(r.ok && d && d.ok===true){
          setLoading(false);
          onLogin("admin", d.nome||"Admin Master", email.trim(), []);
          return;
        }
        if(d && d.erro==="nao_configurado") adminCfgPendente = true;
      } catch(e){ /* API indisponível — segue para os demais perfis normalmente */ }
      setLoading(false);
      // Clínica — verifica nas clínicas cadastradas (e-mail sem diferenciar maiúsculas/espaços)
      const emailNorm = email.trim().toLowerCase();
      let clinica = null;
      for(const c of clinicas){ if((c.email||"").trim().toLowerCase()===emailNorm && await SENHA_FP.conferir(pass,c)){ clinica=c; break; } }
      if(clinica){
        onLogin("clinica",clinica.nome,clinica.email,[],clinica.id);
        return;
      }
      // Paciente — verifica usuário/senha ou e-mail/senha
      let pac = null;
      for(const p of (pacientes||[])){ if(((p.usuario&&p.usuario===email.trim())||(p.email&&p.email===email.trim())) && await SENHA_FP.conferir(pass,p)){ pac=p; break; } }
      if(pac){
        onLogin("paciente",`${pac.nome} ${pac.sobrenome}`,pac.usuario||pac.email,[],pac.id);
        return;
      }
      // Colaborador da clínica — acesso restrito (sem financeiro/valores)
      // Busca na nuvem primeiro (o colaborador pode ter sido criado em outro dispositivo)
      let todosColab = [];
      try { todosColab = (await LS.readAsync("fp:colaboradores")) || []; } catch(e) {}
      if(!todosColab || todosColab.length===0) todosColab = LS.read("fp:colaboradores") || [];
      let colab = null;
      for(const c of (todosColab||[])){ if(c.usuario===email.trim() && await SENHA_FP.conferir(pass,c)){ colab=c; break; } }
      if(colab){
        onLogin("colaborador",colab.nome,colab.usuario,[],colab.clinicaId);
        return;
      }
      setErr(adminCfgPendente
        ? "E-mail ou senha incorretos. (Aviso do sistema: o login do administrador ainda não foi configurado no servidor — crie as variáveis ADMIN_EMAIL e ADMIN_PASS na Vercel e faça um novo deploy.)"
        : "E-mail ou senha incorretos. Verifique seus dados.");
    },1000);
  };

  return (
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",position:"relative",overflow:"hidden"}}>
      <GridBg/><Particles/>
      <div style={{position:"absolute",width:480,height:480,background:`radial-gradient(circle,${C.glow} 0%,transparent 70%)`,top:"25%",left:"62%",transform:"translate(-50%,-50%)",animation:"float 9s ease-in-out infinite"}}/>
      <div style={{position:"relative",zIndex:1,width:"100%",maxWidth:mode==="encontre"?780:400,padding:"0 20px"}}>
        <div style={{textAlign:"center",marginBottom:30,animation:"fadeUp .6s ease both"}}>
          <div style={{position:"relative",width:74,height:74,margin:"0 auto 14px"}}>
            <div style={{position:"absolute",inset:-12,borderRadius:"50%",background:`radial-gradient(circle,${C.glow} 0%,transparent 70%)`,animation:"float 5s ease-in-out infinite"}}/>
            <div style={{position:"relative",width:74,height:74,borderRadius:22,background:`linear-gradient(135deg,${C.accent},${C.purple})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:34,boxShadow:`0 8px 40px ${C.accent}55, inset 0 1px 0 rgba(255,255,255,.25)`}}>🦶</div>
          </div>
          <div style={{fontSize:30,fontWeight:900,letterSpacing:"-1px"}}>Fisio<span style={{color:C.accent}}>Piede</span></div>
          <div style={{fontSize:10,color:C.sub,marginTop:5,letterSpacing:".18em",textTransform:"uppercase",fontWeight:700}}>Health Tech Platform</div>
          <div style={{display:"inline-flex",alignItems:"center",gap:6,marginTop:12,padding:"5px 13px",background:C.bgGlass,border:`1px solid ${C.border}`,borderRadius:99,fontSize:10,color:C.sub}}>
            <span style={{width:7,height:7,borderRadius:"50%",background:C.green,boxShadow:`0 0 8px ${C.green}`}}/>
            Inteligência clínica em biomecânica
          </div>
        </div>
        <Card hover={false} p={28} style={{animation:"fadeUp .6s .1s ease both",opacity:0}}>
          {mode==="login" && (
            <div>
              <div style={{marginBottom:20,fontSize:16,fontWeight:800}}>Acessar plataforma</div>
              <div style={{display:"flex",flexDirection:"column",gap:12}}>
                <div><label>E-mail</label><input value={email} onChange={e=>setEmail(e.target.value)} placeholder="admin@fisiopiede.com.br" type="email" onKeyDown={e=>e.key==="Enter"&&handle()}/></div>
                <div><label>Senha</label>
                  <div style={{position:"relative"}}>
                    <input value={pass} onChange={e=>setPass(e.target.value)} placeholder="••••••••" type={showP?"text":"password"} onKeyDown={e=>e.key==="Enter"&&handle()}/>
                    <button onClick={()=>setShowP(!showP)} style={{position:"absolute",right:11,top:"50%",transform:"translateY(-50%)",background:"none",color:C.muted,fontSize:13}}>{showP?"🙈":"👁"}</button>
                  </div>
                </div>
                <Btn v="primary" onClick={handle} disabled={loading} sz="lg" full>{loading?<><Spin sz={14}/> Autenticando...</>:"Entrar →"}</Btn>
                {err&&<div style={{padding:"9px 12px",background:`${C.red}10`,border:`1px solid ${C.red}28`,borderRadius:8,fontSize:12,color:C.red,fontWeight:600}}>⚠️ {err}</div>}
              </div>
              <div style={{display:"flex",justifyContent:"space-between",marginTop:12}}>
                <button onClick={()=>setMode("recover")} style={{background:"none",color:C.muted,fontSize:11}}>Esqueci minha senha</button>
                <button onClick={()=>setMode("access")} style={{background:"none",color:C.soft,fontSize:11,fontWeight:600}}>Solicitar acesso →</button>
              </div>
              <div style={{marginTop:18,display:"flex",alignItems:"center",justifyContent:"center",gap:7,fontSize:11,color:C.muted}}>
                <span style={{width:6,height:6,borderRadius:"50%",background:C.green,display:"inline-block"}}/>
                Ambiente seguro · Seus dados são protegidos
              </div>
            </div>
          )}
          {mode==="recover" && (
            <div>
              <div style={{marginBottom:5,fontSize:16,fontWeight:800}}>Recuperar senha</div>
              <div style={{marginBottom:16,fontSize:12,color:C.muted}}>Enviaremos um link seguro para seu e-mail</div>
              {sent
                ? <div style={{padding:13,background:`${C.green}10`,border:`1px solid ${C.green}28`,borderRadius:10,color:C.green,fontSize:13,textAlign:"center"}}>✓ Link enviado!</div>
                : <div style={{display:"flex",flexDirection:"column",gap:11}}><input placeholder="seu@email.com" type="email"/><Btn v="primary" sz="lg" full onClick={()=>setSent(true)}>Enviar link</Btn></div>
              }
              <Btn v="ghost" sz="sm" onClick={()=>{setMode("login");setSent(false);}} style={{marginTop:10,width:"100%",justifyContent:"center"}}>← Voltar</Btn>
            </div>
          )}
          {mode==="encontre" && (()=>{
            // Só clínicas com licença em dia E autorizadas pelo admin (🗺️ mostrarDiretorio) aparecem no diretório público
            const ativas = (clinicas||[]).filter(c=>{
              if(c.mostrarDiretorio!==true) return false;
              try { const s=ASSINATURA.calcular(c).status; return s==="Ativa"||s==="Em atraso"; } catch(e){ return true; }
            });
            const ufs = [...new Set(ativas.map(c=>(c.estado||"").trim().toUpperCase()).filter(Boolean))].sort();
            const q = buscaCli.trim().toLowerCase();
            const lista = ativas.filter(c=>{
              const okUf = !ufCli || (c.estado||"").trim().toUpperCase()===ufCli;
              const okQ = !q || [c.nome,c.cidade,c.bairro].some(v=>(v||"").toLowerCase().includes(q));
              return okUf && okQ;
            });
            const wapp = (t)=>{ const d=(t||"").replace(/\D/g,""); return d ? "https://wa.me/"+(d.length<=11?"55"+d:d) : null; };
            return (
              <div>
                <div style={{marginBottom:4,fontSize:17,fontWeight:800}}>📍 Encontre uma clínica FisioPiede</div>
                <div style={{marginBottom:16,fontSize:12,color:C.muted,lineHeight:1.6}}>Clínicas licenciadas com tecnologia de palmilhas posturais 3D e inteligência clínica em biomecânica.</div>
                <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
                  <input value={buscaCli} onChange={e=>setBuscaCli(e.target.value)} placeholder="🔎 Busque por cidade, bairro ou nome da clínica..." style={{flex:"2 1 220px"}}/>
                  <select value={ufCli} onChange={e=>setUfCli(e.target.value)} style={{flex:"1 1 110px"}}>
                    <option value="">Todos os estados</option>
                    {ufs.map(u=><option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                {lista.length===0 && (
                  <div style={{textAlign:"center",padding:"28px 16px",color:C.muted}}>
                    <div style={{fontSize:30,marginBottom:8}}>🦶</div>
                    <div style={{fontSize:13,fontWeight:700,color:C.sub}}>Nenhuma clínica encontrada {q||ufCli?"com esse filtro":""}</div>
                    <div style={{fontSize:11,marginTop:5,lineHeight:1.6}}>Estamos expandindo! Em breve uma clínica FisioPiede perto de você.</div>
                  </div>
                )}
                <div style={{display:"flex",flexDirection:"column",gap:9,maxHeight:380,overflowY:"auto",paddingRight:4}}>
                  {lista.map(c=>{
                    const w = wapp(c.tel||c.telefone);
                    return (
                      <div key={c.id} style={{display:"flex",alignItems:"center",gap:12,padding:"13px 14px",background:C.bgGlass,border:`1px solid ${C.border}`,borderRadius:11}}>
                        <div style={{width:42,height:42,borderRadius:12,flexShrink:0,background:`linear-gradient(135deg,${C.accent},${C.purple})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,fontWeight:900,color:"#fff"}}>{(c.nome||"?").trim().charAt(0).toUpperCase()}</div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:13.5,fontWeight:800,color:C.text}}>{c.nome}</div>
                          <div style={{fontSize:11,color:C.muted,marginTop:2}}>📍 {[c.bairro,c.cidade].filter(Boolean).join(" · ")}{c.estado?`/${(c.estado||"").trim().toUpperCase()}`:""}</div>
                          <div style={{fontSize:9.5,color:C.green,fontWeight:700,marginTop:3}}>✓ Clínica licenciada FisioPiede</div>
                        </div>
                        {w
                          ? <a href={w} target="_blank" rel="noreferrer" style={{textDecoration:"none",flexShrink:0}}><Btn v="success" sz="sm">💬 WhatsApp</Btn></a>
                          : <span style={{fontSize:10,color:C.muted,flexShrink:0}}>{c.cidade||""}</span>}
                      </div>
                    );
                  })}
                </div>
                <div style={{marginTop:16,padding:"13px 15px",background:`${C.accent}0A`,border:`1px solid ${C.accent}25`,borderRadius:11,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
                  <div style={{fontSize:11.5,color:C.sub,lineHeight:1.5}}><strong style={{color:C.text}}>É fisioterapeuta ou tem uma clínica?</strong><br/>Leve a tecnologia FisioPiede para os seus pacientes.</div>
                  <Btn v="primary" sz="sm" onClick={()=>{setMode("access");setErr("");}}>Quero ser licenciado →</Btn>
                </div>
                <Btn v="ghost" sz="sm" onClick={()=>{setMode("login");setBuscaCli("");setUfCli("");}} style={{marginTop:12,width:"100%",justifyContent:"center"}}>← Voltar ao login</Btn>
              </div>
            );
          })()}

          {mode==="access" && (
            <div>
              {sent ? (
                <div style={{textAlign:"center",padding:"20px 0"}}>
                  <div style={{fontSize:44,marginBottom:12}}>✅</div>
                  <div style={{fontSize:17,fontWeight:800,marginBottom:8}}>Solicitação enviada!</div>
                  <div style={{fontSize:12,color:C.muted,lineHeight:1.7,marginBottom:20}}>Recebemos seu interesse em se tornar uma clínica licenciada FisioPiede. Nossa equipe vai analisar e entrar em contato pelo e-mail informado em breve.</div>
                  <Btn v="primary" full onClick={()=>{setMode("login");setSent(false);setSolic({clinica:"",cnpj:"",cpf:"",responsavel:"",telefone:"",email:"",cep:"",rua:"",numero:"",complemento:"",bairro:"",cidade:"",estado:""});}}>Voltar ao início</Btn>
                </div>
              ) : (
                <div>
                  <div style={{marginBottom:5,fontSize:16,fontWeight:800}}>Solicitar licença</div>
                  <div style={{marginBottom:16,fontSize:12,color:C.muted}}>Preencha para ser avaliado pela nossa equipe comercial</div>
                  {refIndicacao && (
                    <div style={{marginBottom:14,padding:"11px 13px",background:`${C.gold}0E`,border:`1px solid ${C.gold}38`,borderRadius:10}}>
                      <div style={{fontSize:11.5,fontWeight:800,color:C.gold,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>👑 ✓ Você foi indicado por: <span style={{color:C.text}}>{(clinicaIndicadora&&clinicaIndicadora.nome)||"uma clínica parceira FisioPiede"}</span></div>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginTop:8}}>
                        <input value={refIndicacao} readOnly disabled style={{flex:1,fontFamily:"'Space Mono',monospace",fontWeight:800,letterSpacing:".06em",color:C.gold,opacity:.85,cursor:"not-allowed"}}/>
                        <span style={{fontSize:9,color:C.muted,whiteSpace:"nowrap"}}>🔒 código de indicação</span>
                      </div>
                    </div>
                  )}
                  <div style={{maxHeight:"52vh",overflowY:"auto",paddingRight:4}}>
                    <div style={{fontSize:10,fontWeight:800,color:C.accent,letterSpacing:".08em",textTransform:"uppercase",marginBottom:8}}>Dados da Clínica</div>
                    <div style={{display:"flex",flexDirection:"column",gap:9,marginBottom:16}}>
                      <input placeholder="Nome da clínica *" value={solic.clinica} onChange={e=>setSolic({...solic,clinica:e.target.value})}/>
                      <input placeholder="CNPJ" value={solic.cnpj} onChange={e=>setSolic({...solic,cnpj:e.target.value})}/>
                      <input placeholder="CPF do responsável" value={solic.cpf} onChange={e=>setSolic({...solic,cpf:e.target.value})}/>
                      <input placeholder="Responsável" value={solic.responsavel} onChange={e=>setSolic({...solic,responsavel:e.target.value})}/>
                      <input placeholder="Telefone / WhatsApp" value={solic.telefone} onChange={e=>setSolic({...solic,telefone:e.target.value})}/>
                      <input placeholder="E-mail *" value={solic.email} onChange={e=>setSolic({...solic,email:e.target.value})}/>
                    </div>
                    <div style={{fontSize:10,fontWeight:800,color:C.accent,letterSpacing:".08em",textTransform:"uppercase",marginBottom:8}}>▸ Endereço</div>
                    <div style={{display:"flex",flexDirection:"column",gap:9}}>
                      <input placeholder="CEP" value={solic.cep} onChange={e=>setSolic({...solic,cep:e.target.value})}/>
                      <input placeholder="Rua / Logradouro" value={solic.rua} onChange={e=>setSolic({...solic,rua:e.target.value})}/>
                      <div style={{display:"flex",gap:9}}>
                        <input placeholder="Número" value={solic.numero} onChange={e=>setSolic({...solic,numero:e.target.value})} style={{flex:1}}/>
                        <input placeholder="Complemento" value={solic.complemento} onChange={e=>setSolic({...solic,complemento:e.target.value})} style={{flex:2}}/>
                      </div>
                      <input placeholder="Bairro" value={solic.bairro} onChange={e=>setSolic({...solic,bairro:e.target.value})}/>
                      <div style={{display:"flex",gap:9}}>
                        <input placeholder="Cidade" value={solic.cidade} onChange={e=>setSolic({...solic,cidade:e.target.value})} style={{flex:2}}/>
                        <input placeholder="Estado" value={solic.estado} onChange={e=>setSolic({...solic,estado:e.target.value})} style={{flex:1}}/>
                      </div>
                    </div>
                  </div>
                  {err && <div style={{fontSize:11,color:C.red,marginTop:10}}>{err}</div>}
                  <div style={{display:"flex",flexDirection:"column",gap:9,marginTop:14}}>
                    <Btn v="success" sz="lg" full onClick={enviarSolicitacao}>Enviar solicitação</Btn>
                    <Btn v="ghost" sz="sm" onClick={()=>{setMode("login");setErr("");}} style={{justifyContent:"center"}}>← Voltar</Btn>
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
        <div style={{textAlign:"center",marginTop:18}}>
          <div style={{display:"flex",justifyContent:"center",gap:14,marginBottom:8,fontSize:10,color:C.sub}}>
            <span style={{display:"flex",alignItems:"center",gap:4}}>🔒 Dados protegidos</span>
            <span style={{display:"flex",alignItems:"center",gap:4}}>✦ IA clínica</span>
            <span style={{display:"flex",alignItems:"center",gap:4}}>🛡️ LGPD</span>
          </div>
          <div style={{fontSize:10,color:C.muted}}>© {new Date().getFullYear()} FisioPiede Health Tech Platform</div>
        </div>
      </div>
    </div>
  );
}

// ─── DASHBOARD ADMIN ──────────────────────────────────────────────────────────
function DashAdmin({pedidos,clinicas,onNavegar}) {
  // 📡 Consumo de IA REAL, vindo da nuvem: o contador de cada clínica vive no
  // aparelho DELA (e na nuvem). Aqui buscamos todos de uma vez para o Radar.
  const [usoNuvem,setUsoNuvem] = useState(null);
  const [extraNuvem,setExtraNuvem] = useState({});
  useEffect(()=>{ (async()=>{
    if(!useBackend) return;
    try{
      const d=new Date(); const mes=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
      const r = await fetch(`${BACKEND.url}/rest/v1/app_data?chave=like.fp:iauso:*:${mes}&select=chave,valor`,{headers:DB.headers()});
      if(r.ok){ const rows=await r.json(); const m={}; for(const row of (rows||[])){ const id=String(row.chave).split(":")[2]; m[id]=(row.valor&&typeof row.valor.n==="number")?row.valor.n:0; } setUsoNuvem(m); }
      const r2 = await fetch(`${BACKEND.url}/rest/v1/app_data?chave=like.fp:iaextra:*&select=chave,valor`,{headers:DB.headers()});
      if(r2.ok){ const rows=await r2.json(); const m={}; for(const row of (rows||[])){ const id=String(row.chave).split(":")[2]; m[id]=(row.valor&&typeof row.valor.n==="number")?row.valor.n:0; } setExtraNuvem(m); }
    }catch(e){}
  })(); },[]);
  const fat    = pedidos.length*PRECO;
  const emProd = pedidos.filter(p=>["Em Produção","Impressão 3D","Acabamento"].includes(p.status)).length;
  const ativas  = clinicas.filter(c=>{ const s=ASSINATURA.calcular(c).status; return s==="Ativa"||s==="Em atraso"; }).length;
  const inadimp = clinicas.filter(c=>{ const s=ASSINATURA.calcular(c).status; return s==="Suspensa"||s==="Cancelada"; }).length;
  // 💾 Vigia do backup — avisa se nunca fez ou se faz mais de 7 dias
  const diasBackup = (()=>{ try {
    let d = null;
    const iso = LS.read("fp:ultimoBackupISO");
    if(iso){ d = new Date(iso); }
    if(!d || isNaN(d.getTime())){
      const s = LS.read("fp:ultimoBackup");
      const m = s && String(s).match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if(m) d = new Date(+m[3], +m[2]-1, +m[1]);
    }
    if(!d || isNaN(d.getTime())) return null; // nunca registrado
    return Math.max(0, Math.floor((Date.now()-d.getTime())/864e5));
  } catch(e){ return null; } })();
  const backupAtrasado = diasBackup===null || diasBackup>7;
  return (
    <div style={{padding:20,display:"flex",flexDirection:"column",gap:18}}>
      <SH title="Dashboard — Admin Master" sub={new Date().toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}/>
      {backupAtrasado && (
        <Card hover={false} p={0} style={{border:`1px solid ${C.amber}45`,overflow:"hidden"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,padding:"13px 16px",background:`${C.amber}0D`,flexWrap:"wrap"}}>
            <div style={{display:"flex",alignItems:"center",gap:11}}>
              <span style={{fontSize:22}}>💾</span>
              <div>
                <div style={{fontSize:13,fontWeight:800,color:C.amber}}>{diasBackup===null?"Nenhum backup registrado ainda":`Último backup há ${diasBackup} dia${diasBackup!==1?"s":""}`}</div>
                <div style={{fontSize:11,color:C.muted,marginTop:2}}>Seus dados clínicos merecem proteção — o ideal é um backup por semana.</div>
              </div>
            </div>
            <Btn v="primary" sz="sm" onClick={()=>onNavegar&&onNavegar("config")} style={{background:C.amber}}>💾 Fazer backup agora →</Btn>
          </div>
        </Card>
      )}
      {(()=>{
        // 📡 Radar de IA — consumo do mês por clínica (oportunidade de venda do +50)
        const TRIAL_MS = 2*864e5;
        const radar = (clinicas||[]).map(c=>{
          const plano = (c.trialInicio && (Date.now()-new Date(c.trialInicio).getTime())<TRIAL_MS) ? "Trial" : (c.plano||"Básico");
          const extra = extraNuvem[String(c.id)]!==undefined ? extraNuvem[String(c.id)] : creditoExtraIA(c.id);
          const limite = (IA_LIMITE[plano]!==undefined?IA_LIMITE[plano]:0) + extra;
          // prefere o contador da nuvem (uso real das clínicas); local é só fallback
          const uso = (usoNuvem && usoNuvem[String(c.id)]!==undefined) ? usoNuvem[String(c.id)] : IA_USO.atual(c.id);
          return { c, plano, limite, uso, pct: limite>0 ? uso/limite : 0 };
        }).filter(r=>r.limite>0).sort((a,b)=>b.pct-a.pct);
        if(radar.length===0) return null;
        const quentes = radar.filter(r=>r.pct>=0.8).length;
        return (
          <Card hover={false} p={0} style={{overflow:"hidden"}}>
            <div style={{padding:"13px 16px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
              <div>
                <div style={{fontSize:13.5,fontWeight:800}}>📡 Radar de IA — consumo do mês</div>
                <div style={{fontSize:10.5,color:C.muted,marginTop:2}}>Clínica perto do limite = hora certa de oferecer o pacote <strong style={{color:C.green}}>+50 por R$ 49,90</strong></div>
              </div>
              {quentes>0&&<Badge label={`🔥 ${quentes} oportunidade${quentes!==1?"s":""} de venda`} color={C.amber}/>}
            </div>
            <div style={{display:"flex",flexDirection:"column"}}>
              {radar.map(({c,plano,limite,uso,pct})=>{
                const cor = pct>=1?C.red:pct>=0.8?C.amber:C.green;
                return (
                  <div key={c.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 16px",borderTop:`1px solid ${C.border}`}}>
                    <div style={{flex:"1 1 160px",minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>🏥 {c.nome}</div>
                      <div style={{fontSize:9.5,color:C.muted}}>{plano} · limite {limite}/mês</div>
                    </div>
                    <div style={{flex:"2 1 180px",height:8,background:C.bgGlass,borderRadius:99,overflow:"hidden",border:`1px solid ${C.border}`}}>
                      <div style={{width:`${Math.min(100,Math.round(pct*100))}%`,height:"100%",background:cor,borderRadius:99,transition:"width .4s ease"}}/>
                    </div>
                    <div style={{flexShrink:0,fontSize:11.5,fontWeight:800,color:cor,minWidth:64,textAlign:"right"}}>{uso}/{limite}</div>
                    {pct>=1
                      ? <Badge label="esgotou — oferecer +50 💰" color={C.red}/>
                      : pct>=0.8 ? <Badge label="quase lá 🔥" color={C.amber}/> : null}
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })()}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:12}}>
        <MCard label="Clínicas Ativas"   value={ativas}         icon="🏥" color={C.accent} change={8.3}  spark={[30,35,38,36,42,40,ativas]} delay={0}/>
        <MCard label="Pedidos Totais"    value={pedidos.length} icon="📦" color={C.purple} change={12.1} spark={[6,7,8,7,9,9,pedidos.length]} delay={.05}/>
        <MCard label="Faturamento Mês"   value={fat} prefix="R$ " icon="💰" color={C.green} change={9.5} spark={[45000,52000,60000,55000,68000,72000,fat]} delay={.1}/>
        <MCard label="Em Produção"       value={emProd}         icon="⚙️" color={C.amber}  change={-3}   spark={[5,4,6,7,5,4,emProd]} delay={.15}/>
        <MCard label="Clínicas Inadimp." value={inadimp}        icon="⚠️" color={C.red}    change={-2}   spark={[3,2,3,2,2,1,inadimp]} delay={.2}/>
        <MCard label="Ticket Médio"      value={PRECO} prefix="R$ " icon="🎯" color={C.soft} delay={.25}/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:14}}>
        <Card p={18}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <div><div style={{fontWeight:800,fontSize:14}}>Pedidos por Mês 2025</div><div style={{fontSize:11,color:C.muted}}>Crescimento acumulado</div></div>
            <Badge label={`R$ ${brl(PRECO)}/pedido`} color={C.gold}/>
          </div>
          <Bars data={[28,45,52,61,48,67,72,58,81,76,89,pedidos.length]} color={C.accent} labels={["J","F","M","A","M","J","J","A","S","O","N","D"]}/>
        </Card>
        <Card p={18}>
          <div style={{fontWeight:800,fontSize:14,marginBottom:4}}>Status Clínicas</div>
          <div style={{fontSize:11,color:C.muted,marginBottom:16}}>Distribuição atual</div>
          <div style={{display:"flex",alignItems:"center",gap:16}}>
            <Donut segs={[{v:ativas,c:C.green},{v:inadimp,c:C.amber},{v:clinicas.filter(c=>c.status==="Bloqueada").length,c:C.red}]} label={`${clinicas.length}`}/>
            <div style={{display:"flex",flexDirection:"column",gap:8,fontSize:12}}>
              {[{l:"Ativas",c:C.green,k:"Ativa"},{l:"Inadimp.",c:C.amber,k:"Inadimplente"},{l:"Bloq.",c:C.red,k:"Bloqueada"}].map(s=>(
                <div key={s.l} style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:6,height:6,borderRadius:"50%",background:s.c}}/><span style={{color:C.muted}}>{s.l}</span><span style={{fontWeight:800,marginLeft:"auto"}}>{clinicas.filter(c=>c.status===s.k).length}</span></div>
              ))}
            </div>
          </div>
        </Card>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
        <Card p={18}>
          <div style={{fontWeight:800,fontSize:14,marginBottom:12}}>🏆 Ranking Clínicas</div>
          {[...clinicas].sort((a,b)=>(b.pedidosReal??b.pedidos??0)-(a.pedidosReal??a.pedidos??0)).slice(0,6).map((c,i)=>(
            <div key={c.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",borderRadius:9,background:i===0?`${C.accent}07`:"transparent",marginBottom:5}}>
              <span style={{width:18,height:18,borderRadius:4,background:i<3?[C.gold,C.sub,"#CD7F32"][i]+"18":"transparent",display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,fontWeight:900,color:i<3?[C.gold,C.sub,"#CD7F32"][i]:C.muted}}>#{i+1}</span>
              <div style={{flex:1}}><div style={{fontSize:12,fontWeight:600}}>{c.nome}</div><div style={{fontSize:10,color:C.muted}}>{c.pedidosReal??c.pedidos??0} pedidos</div></div>
              <div style={{fontSize:12,fontWeight:800,color:C.green}}>R$ {brl((c.pedidosReal??c.pedidos??0)*PRECO)}</div>
            </div>
          ))}
        </Card>
        <Card p={18}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}><div style={{fontWeight:800,fontSize:14}}>Pedidos Recentes</div><Badge label="Hoje" color={C.accent}/></div>
          {pedidos.slice(0,6).map(p=>(
            <div key={p.id} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:9,background:C.bgGlass,border:`1px solid ${C.border}`,marginBottom:5}}>
              <span style={{fontFamily:"'Space Mono',monospace",fontSize:9,color:C.accent,width:36,flexShrink:0}}>{p.id}</span>
              <div style={{flex:1}}><div style={{fontSize:11,fontWeight:600}}>{p.paciente}</div><div style={{fontSize:10,color:C.muted}}>{p.clinica}</div></div>
              <SBadge status={p.status}/>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

// ─── PEDIDOS ───────────────────────────────────────────────────────────────────
function PedidoModal({pedido,isAdmin,onClose,onUpdate}) {
  const [status,setStatus]   = useState(pedido.status);
  const [rastreio,setRastreio] = useState(pedido.rastreio||"");
  const [saved,setSaved]     = useState(false);
  const sc = STATUS_CFG[status]||{color:C.sub};
  const isEnv = ["Enviado","Finalizado"].includes(status);

  const save = () => {
    const t = nowTs();
    const newLog = [...pedido.log];
    const mudouStatus = status!==pedido.status;
    const mudouRastreio = !!(rastreio&&rastreio!==pedido.rastreio);
    if(mudouStatus) newLog.push(`${t} — ${status}`);
    if(mudouRastreio) newLog.push(`${t} — Rastreio: ${rastreio}`);
    onUpdate({...pedido,status,rastreio,updatedAt:t,log:newLog});
    // 🔔 Avisa a clínica e o paciente sobre a mudança (sem quebrar o save se falhar)
    if(isAdmin && (mudouStatus||mudouRastreio)){
      try {
        const sc3 = STATUS_CFG[status]||{icon:"📦"};
        const detalhe = `${pedido.paciente}: ${mudouStatus?`agora "${status}"`:"pedido atualizado"}${mudouRastreio?` · rastreio ${rastreio}`:""}`;
        if(pedido.clinicaId) pushNotif("clinica:"+pedido.clinicaId, sc3.icon||"📦", `Pedido ${pedido.id} — ${status}`, detalhe, "pedidos");
        if(pedido.pacienteId) pushNotif("paciente:"+pedido.pacienteId, "🦶", `Sua palmilha: ${status}`, `Seu pedido ${pedido.id} ${mudouStatus?`está em "${status}"`:"foi atualizado"}${mudouRastreio?`. Código de rastreio: ${rastreio}`:""}.`, "dashboard");
      } catch(e){}
    }
    setSaved(true);
    setTimeout(()=>{setSaved(false);onClose();},700);
  };

  const info = [["Clínica",pedido.clinica],["Data",fmtD(pedido.data)],["Tipo Palmilha",pedido.tipoPalmilha],["Tipo Calçado",pedido.tipoCalcado],["Numeração",pedido.numeracao],["Flexibilidade",pedido.flexibilidade],["Cobertura",pedido.cobertura],["Cor",pedido.cor],["Espessura",pedido.espessura],["Comprimento",(pedido.comprimento||"")+"cm"],["Larg. Antepé",(pedido.larguraAntePe||"")+"cm"],["Larg. Calcâneo",(pedido.larguraCalcaneo||"")+"cm"],["Peso",(pedido.peso||"")+"kg"],["Altura",(pedido.altura||"")+"cm"],["Atualizado",pedido.updatedAt],["Valor",`R$ ${brl(PRECO)}`]];

  return (
    <Modal onClose={onClose}>
      <Card hover={false} p={0} style={{width:"100%",maxWidth:660,maxHeight:"92vh",overflowY:"auto",animation:"fadeUp .22s ease"}}>
        <div style={{padding:"16px 20px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"flex-start",background:`${sc.color}06`}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}><span style={{fontFamily:"'Space Mono',monospace",fontSize:12,color:C.accent,fontWeight:700}}>{pedido.id}</span><SBadge status={status}/></div>
            <div style={{fontSize:18,fontWeight:900}}>{pedido.paciente}</div>
            <div style={{fontSize:12,color:C.muted,marginTop:1}}>{pedido.clinica} · {pedido.tipoPalmilha||pedido.tipo}</div>
          </div>
          <button onClick={onClose} style={{background:"none",color:C.muted,fontSize:18}}>✕</button>
        </div>
        <div style={{padding:20,display:"flex",flexDirection:"column",gap:16}}>
          <div>
            <div style={{fontSize:10,color:C.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",marginBottom:8}}>Dados Técnicos</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:7}}>
              {info.map(([l,v])=>(
                <div key={l} style={{padding:"8px 10px",background:C.bgGlass,borderRadius:8,border:`1px solid ${C.border}`}}>
                  <div style={{fontSize:8,color:C.muted,fontWeight:700,textTransform:"uppercase",marginBottom:2}}>{l}</div>
                  <div style={{fontSize:11,fontWeight:600}}>{v||"—"}</div>
                </div>
              ))}
            </div>
          </div>
          {/* Discriminado por pé */}
          {(pedido.obsDireito||pedido.obsEsquerdo)&&(
            <div style={{background:`${C.accent}04`,border:`1px solid ${C.accent}15`,borderRadius:12,padding:14}}>
              <div style={{fontSize:10,color:C.accent,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",marginBottom:12}}>Discriminado Técnico por Pé</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                <div style={{padding:12,background:C.bgGlass,borderRadius:9,border:`1px solid ${C.accent}20`}}>
                  <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:8}}>
                    <div style={{width:22,height:22,borderRadius:6,background:`${C.accent}20`,border:`1px solid ${C.accent}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:900,color:C.accent}}>PD</div>
                    <span style={{fontSize:12,fontWeight:800,color:C.accent}}>Pé Direito</span>
                  </div>
                  <div style={{fontSize:12,color:C.sub,lineHeight:1.7}}>{pedido.obsDireito||<span style={{color:C.muted,fontStyle:"italic"}}>Não informado</span>}</div>
                </div>
                <div style={{padding:12,background:C.bgGlass,borderRadius:9,border:`1px solid ${C.purple}20`}}>
                  <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:8}}>
                    <div style={{width:22,height:22,borderRadius:6,background:`${C.purple}20`,border:`1px solid ${C.purple}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:900,color:C.purple}}>PE</div>
                    <span style={{fontSize:12,fontWeight:800,color:C.purple}}>Pé Esquerdo</span>
                  </div>
                  <div style={{fontSize:12,color:C.sub,lineHeight:1.7}}>{pedido.obsEsquerdo||<span style={{color:C.muted,fontStyle:"italic"}}>Não informado</span>}</div>
                </div>
              </div>
            </div>
          )}
          {/* Arquivos de digitalização */}
          {pedido.arquivos&&(pedido.arquivos.direito?.length>0||pedido.arquivos.esquerdo?.length>0)&&(
            <div style={{background:`rgba(255,255,255,.02)`,border:`1px solid ${C.border}`,borderRadius:12,padding:14}}>
              <div style={{fontSize:10,color:C.accent,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",marginBottom:12}}>📁 Arquivos de Digitalização</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                {[{label:"Pé Direito",key:"direito",color:C.accent,tag:"PD"},{label:"Pé Esquerdo",key:"esquerdo",color:C.purple,tag:"PE"}].map(({label,key,color,tag})=>(
                  <div key={key}>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
                      <div style={{width:20,height:20,borderRadius:5,background:`${color}20`,border:`1px solid ${color}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:900,color}}>{tag}</div>
                      <span style={{fontSize:11,fontWeight:700,color}}>{label}</span>
                      <span style={{fontSize:9,color:C.muted,marginLeft:"auto"}}>{(pedido.arquivos[key]||[]).length} arquivo{(pedido.arquivos[key]||[]).length!==1?"s":""}</span>
                    </div>
                    {(pedido.arquivos[key]||[]).length===0
                      ? <div style={{padding:"8px 10px",background:C.bgGlass,borderRadius:8,border:`1px solid ${C.border}`,fontSize:11,color:C.muted,textAlign:"center"}}>Nenhum arquivo enviado</div>
                      : <div style={{display:"flex",flexDirection:"column",gap:5}}>
                          {(pedido.arquivos[key]||[]).map((arq,i)=>{
                            const extColor=arq.ext==="STL"?C.green:arq.ext==="OBJ"?C.purple:C.amber;
                            return(
                              <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",background:C.bgGlass,border:`1px solid ${C.border}`,borderRadius:8}}>
                                <div style={{width:26,height:26,borderRadius:6,background:`${extColor}18`,border:`1px solid ${extColor}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,fontWeight:900,color:extColor,flexShrink:0}}>{arq.ext}</div>
                                <div style={{flex:1,minWidth:0}}><div style={{fontSize:11,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{arq.nome}</div><div style={{fontSize:9,color:C.muted}}>{arq.size}</div></div>
                                <div style={{display:"flex",gap:5,flexShrink:0}}>
                                  {arq.dataUrl&&(arq.ext==="JPG"||arq.ext==="JPEG")&&(
                                    <a href={arq.dataUrl} target="_blank" rel="noreferrer" style={{display:"inline-flex",alignItems:"center",gap:3,padding:"3px 8px",borderRadius:6,fontSize:10,fontWeight:700,background:`${C.accent}15`,color:C.accent,textDecoration:"none",border:`1px solid ${C.accent}30`}}>👁 Ver</a>
                                  )}
                                  {arq.dataUrl
                                    ? <a href={arq.dataUrl} download={arq.nome} style={{display:"inline-flex",alignItems:"center",gap:3,padding:"3px 8px",borderRadius:6,fontSize:10,fontWeight:700,background:`${C.green}15`,color:C.green,textDecoration:"none",border:`1px solid ${C.green}30`}}>⬇️ Baixar</a>
                                    : <span style={{fontSize:10,color:C.muted,fontStyle:"italic"}}>Arquivo sem dados</span>
                                  }
                                </div>
                              </div>
                            );
                          })}
                        </div>
                    }
                  </div>
                ))}
              </div>
            </div>
          )}
          {pedido.obs&&<div style={{padding:12,background:`${C.accent}06`,border:`1px solid ${C.accent}14`,borderRadius:10}}><div style={{fontSize:10,color:C.muted,fontWeight:700,textTransform:"uppercase",marginBottom:5}}>Obs. Clínicas</div><div style={{fontSize:12,color:C.sub,lineHeight:1.6}}>{pedido.obs}</div></div>}
          {isAdmin&&(
            <div style={{padding:14,background:`${C.accent}05`,border:`1px solid ${C.accent}14`,borderRadius:11}}>
              <div style={{fontSize:10,color:C.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",marginBottom:10}}>Controle de Status (Admin)</div>
              <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                {STATUS_FLOW.map((s,i)=>{
                  const sc2=STATUS_CFG[s]||{color:C.sub};
                  const isA=s===status, isPast=i<STATUS_FLOW.indexOf(status);
                  return <button key={s} onClick={()=>setStatus(s)} style={{padding:"5px 10px",borderRadius:7,fontSize:11,fontWeight:700,border:`1px solid ${isA?sc2.color:isPast?sc2.color+"40":C.border}`,background:isA?`${sc2.color}20`:isPast?`${sc2.color}07`:"transparent",color:isA?sc2.color:isPast?sc2.color+"90":C.muted,cursor:"pointer",transition:"all .14s",outline:isA?`2px solid ${sc2.color}28`:"none"}}>{sc2.icon} {s}</button>;
                })}
              </div>
            </div>
          )}
          <div style={{padding:14,background:isEnv?`${C.green}06`:C.bgGlass,border:`1px solid ${isEnv?C.green+"25":C.border}`,borderRadius:11}}>
            <div style={{fontSize:10,color:isEnv?C.green:C.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",marginBottom:10}}>🚚 Rastreamento da Encomenda</div>
            {isAdmin
              ? <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <input value={rastreio} onChange={e=>setRastreio(e.target.value)} placeholder="Código de rastreio — ex.: BR123456789BR"/>
                  {rastreio&&<a href={`https://rastreamento.correios.com.br/app/index.php?objetos=${rastreio}`} target="_blank" rel="noreferrer" style={{padding:"10px 14px",borderRadius:8,fontSize:12,fontWeight:700,background:C.green,color:"#fff",textDecoration:"none",whiteSpace:"nowrap",flexShrink:0}}>🔗 Rastrear</a>}
                </div>
              : rastreio
                ? <div style={{display:"flex",alignItems:"center",gap:12}}><span style={{fontFamily:"'Space Mono',monospace",fontSize:12,color:C.green,fontWeight:700}}>{rastreio}</span><a href={`https://rastreamento.correios.com.br/app/index.php?objetos=${rastreio}`} target="_blank" rel="noreferrer" style={{padding:"7px 13px",borderRadius:8,fontSize:12,fontWeight:700,background:`${C.green}16`,color:C.green,textDecoration:"none",border:`1px solid ${C.green}30`}}>🔗 Rastrear →</a></div>
                : <div style={{fontSize:12,color:C.muted}}>{isEnv?"Aguardando código de rastreio do admin.":"Disponível após o envio."}</div>
            }
          </div>
          <div>
            <div style={{fontSize:10,color:C.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",marginBottom:10}}>Histórico</div>
            {pedido.log.map((entry,i)=>{
              const isL=i===pedido.log.length-1;
              return (
                <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                  <div style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
                    <div style={{width:7,height:7,borderRadius:"50%",flexShrink:0,marginTop:3,background:isL?C.accent:C.muted,boxShadow:isL?`0 0 6px ${C.glow}`:"none"}}/>
                    {!isL&&<div style={{width:1,flex:1,background:C.border,minHeight:15}}/>}
                  </div>
                  <div style={{fontSize:11,color:isL?C.text:C.muted,paddingBottom:isL?0:11,lineHeight:1.4}}>{entry}</div>
                </div>
              );
            })}
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            <Btn v="ghost" onClick={onClose}>Fechar</Btn>
            {isAdmin&&<Btn v={saved?"success":"primary"} onClick={save}>{saved?"✓ Salvo!":"Salvar Alterações"}</Btn>}
          </div>
        </div>
      </Card>
    </Modal>
  );
}

// ─── UPLOAD ZONE por pé ───────────────────────────────────────────────────────
function UploadZone({label,side,files,setFiles}) {
  const ref = useRef();
  const [avisoArq,setAvisoArq] = useState(null);
  const [subindo,setSubindo] = useState(0); // qtd de arquivos sendo enviados pra nuvem agora
  const ACCEPT = [".obj",".stl",".jpg",".jpeg"];
  const COLOR  = side==="D" ? C.accent : C.purple;
  const ICON   = side==="D" ? "🦵" : "🦵";

  const toBase64 = (file) => new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result); // data:...;base64,...
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const handleFiles = async (fileList) => {
    const LIMITE_AVISO_MB = 3.5; // acima disso o anexo ENTRA, mas pedimos envio TAMBÉM por WhatsApp (garantia)
    const LIMITE_MAX_MB   = 10;  // acima disso não dá pra guardar o conteúdo aqui — anexa a referência e o WhatsApp vira obrigatório
    const WHATS_FP = "5519920092864";
    const arr = Array.from(fileList);
    // separa por extensão válida
    const extOk = arr.filter(file => {
      const ext = "."+file.name.split(".").pop().toLowerCase();
      return ACCEPT.includes(ext);
    });
    if(extOk.length===0) return;
    // ✅ NADA é bloqueado: todo arquivo entra.
    // 1º tenta subir pra NUVEM (Supabase Storage) — aí não há limite prático e nem WhatsApp.
    // Se a nuvem falhar (bucket ainda não configurado), cai no caminho antigo: base64 + WhatsApp.
    setSubindo(extOk.length);
    const mapped = await Promise.all(extOk.map(async file => {
      const mb = file.size/1024/1024;
      const base = { name:file.name, size:mb.toFixed(2)+"MB", ext:file.name.split(".").pop().toUpperCase(), grande: mb > LIMITE_AVISO_MB };
      const url = await STORAGE_FP.upload(file);
      if(url) return { ...base, dataUrl:url, nuvem:true };
      let dataUrl = null;
      if(mb <= LIMITE_MAX_MB){ try { dataUrl = await toBase64(file); } catch(e) {} }
      return { ...base, dataUrl, nuvem:false };
    }));
    setSubindo(0);
    // Só pede WhatsApp para os grandes que NÃO conseguiram ir pra nuvem
    const precisamWhats = mapped.filter(f => !f.nuvem && f.grande);
    if(precisamWhats.length>0){
      const nomes = precisamWhats.map(f => `${f.name} (${f.size})`).join(", ");
      setAvisoArq({ nomes, whats: WHATS_FP, obrigatorio: precisamWhats.some(f=>!f.dataUrl) });
    }
    setFiles(prev => [...prev, ...mapped]);
  };

  const remove = idx => setFiles(prev => prev.filter((_,i)=>i!==idx));

  const onDrop = e => { e.preventDefault(); handleFiles(e.dataTransfer.files); };
  const onDragOver = e => e.preventDefault();

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
        <div style={{width:22,height:22,borderRadius:6,background:`${COLOR}20`,border:`1px solid ${COLOR}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:900,color:COLOR}}>P{side}</div>
        <label style={{margin:0,color:COLOR,fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em"}}>Pé {side==="D"?"Direito":"Esquerdo"} — Arquivos de Digitalização</label>
      </div>
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onClick={()=>ref.current.click()}
        style={{border:`2px dashed ${COLOR}40`,borderRadius:11,padding:files.length?14:20,textAlign:"center",color:C.muted,fontSize:12,cursor:"pointer",background:`${COLOR}05`,transition:"all .2s",minHeight:72,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:6}}
      >
        <input ref={ref} type="file" accept=".obj,.stl,.jpg,.jpeg" multiple style={{display:"none"}} onChange={e=>handleFiles(e.target.files)}/>
        {files.length===0 && (
          <>
            <div style={{fontSize:28}}>📁</div>
            <div style={{fontWeight:600,color:COLOR}}>Arraste ou clique para adicionar</div>
            <div style={{fontSize:10,color:C.muted}}>OBJ · STL · JPG — arquivos grandes também são aceitos</div>
          </>
        )}
        {files.length>0 && (
          <div style={{fontWeight:600,color:COLOR,fontSize:11}}>+ Adicionar mais arquivos</div>
        )}
        {subindo>0 && (
          <div style={{display:"flex",alignItems:"center",gap:7,fontSize:11,color:COLOR,fontWeight:700}}><Spin sz={13} color={COLOR}/> Enviando {subindo} arquivo{subindo!==1?"s":""} para a nuvem...</div>
        )}
      </div>
      {files.length>0 && (
        <div style={{display:"flex",flexDirection:"column",gap:5,marginTop:8}}>
          {files.map((file,i)=>{
            const extColor = file.ext==="STL"?C.green:file.ext==="OBJ"?C.purple:C.amber;
            return (
              <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",background:C.bgGlass,border:`1px solid ${C.border}`,borderRadius:8}}>
                <div style={{width:28,height:28,borderRadius:6,background:`${extColor}18`,border:`1px solid ${extColor}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:900,color:extColor,flexShrink:0}}>{file.ext}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:11,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{file.name}</div>
                  <div style={{fontSize:9,color:C.muted}}>{file.size}</div>
                </div>
                {file.nuvem ? (
                  <span style={{fontSize:10,color:C.green,fontWeight:700,flexShrink:0}}>☁️ Na nuvem ✓</span>
                ): file.dataUrl && (file.ext==="JPG"||file.ext==="JPEG") ? (
                  <a href={file.dataUrl} target="_blank" rel="noreferrer" style={{fontSize:10,color:C.accent,fontWeight:700,textDecoration:"none",flexShrink:0}}>👁 Ver</a>
                ): !file.dataUrl ? (
                  <span style={{fontSize:10,color:C.amber,fontWeight:700,flexShrink:0}}>📱 enviar por WhatsApp</span>
                ): file.grande ? (
                  <span style={{fontSize:10,color:C.amber,fontWeight:700,flexShrink:0}}>✓ Anexado · reforçar no Whats</span>
                ):(
                  <span style={{fontSize:10,color:C.green,fontWeight:700,flexShrink:0}}>✓ Pronto</span>
                )}
                <button onClick={e=>{e.stopPropagation();remove(i);}} style={{background:"none",color:C.red,fontSize:14,padding:"0 2px",flexShrink:0}}>✕</button>
              </div>
            );
          })}
        </div>
      )}
      {avisoArq && (
        <div style={{marginTop:8,padding:"11px 13px",background:`${C.amber}10`,border:`1px solid ${C.amber}40`,borderRadius:9}}>
          <div style={{fontSize:11.5,color:C.amber,fontWeight:700,marginBottom:4}}>{avisoArq.obrigatorio?"📱 Arquivo muito grande — envie pelo WhatsApp":"✅ Anexado! Mas como é grande, reforça no WhatsApp"}</div>
          <div style={{fontSize:11,color:C.sub,lineHeight:1.5,marginBottom:8}}>
            {avisoArq.obrigatorio
              ? <>O arquivo <strong>{avisoArq.nomes}</strong> é grande demais para viajar dentro do pedido (acima de 10MB). Guardamos a referência dele aqui, mas o conteúdo <strong style={{color:C.amber}}>precisa</strong> ser enviado pelo WhatsApp, citando o nome do paciente.</>
              : <>O arquivo <strong>{avisoArq.nomes}</strong> foi anexado ao pedido normalmente. Como ele é grande, envie uma cópia também pelo WhatsApp (citando o nome do paciente) — assim garantimos que ele chegue perfeito na produção. 👌</>}
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <a href={`https://wa.me/${avisoArq.whats}?text=${encodeURIComponent("Olá! Estou enviando por aqui o arquivo 3D grande de um pedido (garantia de entrega): "+avisoArq.nomes)}`} target="_blank" rel="noreferrer" style={{textDecoration:"none"}}><Btn v="success" sz="sm">📱 Enviar pelo WhatsApp</Btn></a>
            <Btn v="ghost" sz="sm" onClick={()=>setAvisoArq(null)}>Entendi</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

function NovoPedidoModal({onClose,onSave,pacientes,clinicaName,clinicaId}) {
  const [f,setF] = useState({paciente:"",produto:"",tipoPalmilha:"Inteira",tipoCalcado:"Tênis",flexibilidade:"Normal",cobertura:"EVA Perfurado",cor:"Preto",espessura:"4mm",comprimento:"",larguraAntePe:"",larguraCalcaneo:"",obsDireito:"",obsEsquerdo:"",obs:""});
  const [numManual,setNumManual] = useState("");
  const [filesDireito, setFilesDireito]   = useState([]);
  const [filesEsquerdo, setFilesEsquerdo] = useState([]);
  const set = (k,v) => setF(prev=>({...prev,[k]:v}));
  const nomesP = pacientes.map(p=>`${p.nome} ${p.sobrenome||""}`.trim());
  const pac = pacientes.find(p=>`${p.nome} ${p.sobrenome||""}`.trim()===f.paciente.trim())||{};
  const numEfetivo = (pac.numeracao && String(pac.numeracao).trim()) || (numManual && String(numManual).trim()) || "";
  const totalArqs = filesDireito.length + filesEsquerdo.length;

  const [criados,setCriados] = useState(0); // pedidos já criados nesta sessão do modal (cesta)

  const F_INICIAL = {paciente:"",produto:"",tipoPalmilha:"Inteira",tipoCalcado:"Tênis",flexibilidade:"Normal",cobertura:"EVA Perfurado",cor:"Preto",espessura:"4mm",comprimento:"",larguraAntePe:"",larguraCalcaneo:"",obsDireito:"",obsEsquerdo:"",obs:""};
  const montarPedido = () => {
    if(!f.paciente){ alert("Selecione o paciente."); return null; }
    if(!f.produto){ alert("Selecione o tipo: Tênis, Sapato ou Chinelo."); return null; }
    if(!numEfetivo){ alert("⚠️ Informe o NÚMERO DO CALÇADO do paciente para concluir o pedido."); return null; }
    if(filesDireito.length + filesEsquerdo.length === 0){ alert("⚠️ Anexe o arquivo da digitalização da palmilha (pé direito e/ou esquerdo) antes de enviar o pedido."); return null; }
    const t=nowTs(), id=`#${5100+Math.floor(Math.random()*900)}`;
    const arquivos = {
      direito:  filesDireito.map(f=>({nome:f.name,ext:f.ext,size:f.size,dataUrl:f.dataUrl,nuvem:!!f.nuvem})),
      esquerdo: filesEsquerdo.map(f=>({nome:f.name,ext:f.ext,size:f.size,dataUrl:f.dataUrl,nuvem:!!f.nuvem})),
    };
    return {id,clinicaId:clinicaId||null,clinica:clinicaName||"—",paciente:f.paciente,pacienteId:(pac&&pac.id)||null,tipo:f.tipoPalmilha,status:"Recebido",data:new Date().toISOString().split("T")[0],rastreio:"",updatedAt:t,log:[`${t} — Recebido`],peso:pac.peso||"",altura:pac.altura||"",numeracao:numEfetivo,arquivos,remessaId:null,enviado:false,...f};
  };
  const save = () => {
    const p = montarPedido(); if(!p) return;
    onSave(p);
    onClose();
  };
  const saveEoutro = () => {
    const p = montarPedido(); if(!p) return;
    onSave(p);
    setCriados(c=>c+1);
    setF(F_INICIAL); setNumManual(""); setFilesDireito([]); setFilesEsquerdo([]);
  };

  return (
    <Modal onClose={onClose}>
      <Card hover={false} p={0} style={{width:"100%",maxWidth:720,maxHeight:"93vh",overflowY:"auto",animation:"fadeUp .25s ease"}}>
        <div style={{padding:"16px 20px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",background:`linear-gradient(135deg,${C.accent}07,${C.purple}04)`}}>
          <div>
            <div style={{fontSize:17,fontWeight:800}}>Novo Pedido de Palmilha</div>
            <div style={{fontSize:11,color:C.muted,marginTop:2}}>Preencha todos os dados técnicos e anexe os arquivos de digitalização</div>
          </div>
          <button onClick={onClose} style={{background:"none",color:C.muted,fontSize:18}}>✕</button>
        </div>
        <div style={{padding:20,display:"flex",flexDirection:"column",gap:20}}>

          {/* Paciente */}
          <div>
            <div style={{fontSize:10,color:C.accent,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",marginBottom:10}}>▸ Paciente</div>
            <label>Selecionar Paciente</label>
            <select value={f.paciente} onChange={e=>set("paciente",e.target.value)}><option value="">— Selecione —</option>{nomesP.map(n=><option key={n}>{n}</option>)}</select>
            {f.paciente&&(pac.numeracao
              ? <div style={{marginTop:8,padding:"7px 11px",background:`${C.accent}07`,border:`1px solid ${C.accent}18`,borderRadius:8,fontSize:11,color:C.sub}}>📋 Nº do calçado: <strong style={{color:C.accent}}>{pac.numeracao}</strong> · Peso: <strong>{pac.peso||"—"}kg</strong> · Altura: <strong>{pac.altura||"—"}cm</strong></div>
              : <div style={{marginTop:8,padding:"10px 12px",background:`${C.amber}0C`,border:`1px solid ${C.amber}40`,borderRadius:8}}>
                  <div style={{fontSize:11,color:C.amber,fontWeight:600,marginBottom:7}}>⚠️ O número do calçado não veio do cadastro. Informe abaixo para concluir o pedido:</div>
                  <label style={{fontSize:11,color:C.sub}}>Nº do calçado *</label>
                  <input value={numManual} onChange={e=>setNumManual(e.target.value)} placeholder="Ex: 42" style={{width:"100%",marginTop:3}} />
                </div>
            )}
          </div>

          {/* Tipo do produto — obrigatório, define o valor */}
          <div>
            <div style={{fontSize:10,color:C.accent,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",marginBottom:10}}>▸ Tipo <span style={{color:C.red}}>*</span></div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
              {[["Tênis","👟","R$ 280"],["Sapato","👞","R$ 280"],["Chinelo","🩴","R$ 380"]].map(([nome,ic,preco])=>(
                <div key={nome} onClick={()=>set("produto",nome)} style={{padding:"14px 10px",borderRadius:10,cursor:"pointer",textAlign:"center",border:`2px solid ${f.produto===nome?C.accent:C.border}`,background:f.produto===nome?`${C.accent}10`:"transparent",transition:"all .15s"}}>
                  <div style={{fontSize:26,marginBottom:5}}>{ic}</div>
                  <div style={{fontSize:13,fontWeight:700,color:f.produto===nome?C.accent:C.text}}>{nome}</div>
                  <div style={{fontSize:11,color:f.produto===nome?C.accent:C.muted,marginTop:2}}>{preco}</div>
                </div>
              ))}
            </div>
            {!f.produto&&<div style={{fontSize:11,color:C.muted,marginTop:7}}>Selecione o tipo para continuar.</div>}
          </div>

          {/* Especificações */}
          <div>
            <div style={{fontSize:10,color:C.accent,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",marginBottom:10}}>▸ Especificações da Palmilha</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
              {[["Tipo de Calçado","tipoCalcado",["Tênis","Social","Chinelo","Sandália"]],["Tipo de Palmilha","tipoPalmilha",["Inteira","Fina","Chinelo"]],["Flexibilidade","flexibilidade",["Flexível","Normal","Rígida"]],["Cobertura","cobertura",["EVA Perfurado","Sintético","Tecido"]],["Cor","cor",["Preto","Marrom"]]].map(([l,k,opts])=>(
                <div key={k}><label>{l}</label><select value={f[k]} onChange={e=>set(k,e.target.value)}>{opts.map(o=><option key={o}>{o}</option>)}</select></div>
              ))}
              <div><label>Espessura EVA</label><input value={f.espessura} onChange={e=>set("espessura",e.target.value)} placeholder="Ex.: 4mm"/></div>
            </div>
          </div>

          {/* Medidas */}
          <div>
            <div style={{fontSize:10,color:C.accent,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",marginBottom:10}}>▸ Medidas (cm)</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
              {[["Comprimento","comprimento","25.5"],["Larg. Antepé","larguraAntePe","8.5"],["Larg. Calcâneo","larguraCalcaneo","6.8"]].map(([l,k,ph])=>(
                <div key={k}><label>{l}</label><input value={f[k]} onChange={e=>set(k,e.target.value)} placeholder={ph}/></div>
              ))}
            </div>
          </div>

          {/* Discriminado por pé */}
          <div style={{background:`${C.accent}04`,border:`1px solid ${C.accent}15`,borderRadius:12,padding:16}}>
            <div style={{fontSize:10,color:C.accent,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",marginBottom:14}}>▸ Discriminado Técnico por Pé</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
              {/* PÉ DIREITO */}
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                <div style={{display:"flex",alignItems:"center",gap:7}}>
                  <div style={{width:22,height:22,borderRadius:6,background:`${C.accent}20`,border:`1px solid ${C.accent}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:900,color:C.accent}}>PD</div>
                  <span style={{fontSize:12,fontWeight:800,color:C.accent}}>Pé Direito</span>
                </div>
                <textarea rows={4} value={f.obsDireito} onChange={e=>set("obsDireito",e.target.value)} placeholder="Descreva as especificações técnicas do pé direito: correções, apoios, sobrecargas observadas, adaptações necessárias..." style={{resize:"vertical"}}/>
              </div>
              {/* PÉ ESQUERDO */}
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                <div style={{display:"flex",alignItems:"center",gap:7}}>
                  <div style={{width:22,height:22,borderRadius:6,background:`${C.purple}20`,border:`1px solid ${C.purple}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:900,color:C.purple}}>PE</div>
                  <span style={{fontSize:12,fontWeight:800,color:C.purple}}>Pé Esquerdo</span>
                </div>
                <textarea rows={4} value={f.obsEsquerdo} onChange={e=>set("obsEsquerdo",e.target.value)} placeholder="Descreva as especificações técnicas do pé esquerdo: correções, apoios, sobrecargas observadas, adaptações necessárias..." style={{resize:"vertical"}}/>
              </div>
            </div>
          </div>

          {/* Upload de digitalização por pé */}
          <div style={{background:`rgba(255,255,255,.02)`,border:`1px solid ${C.border}`,borderRadius:12,padding:16}}>
            <div style={{fontSize:10,color:C.accent,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",marginBottom:4}}>▸ Arquivos de Digitalização do Pé</div>
            <div style={{fontSize:11,color:C.muted,marginBottom:14}}>Envie os arquivos 3D (.OBJ, .STL) ou fotos (.JPG) de cada pé separadamente</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
              <UploadZone label="Pé Direito" side="D" files={filesDireito} setFiles={setFilesDireito}/>
              <UploadZone label="Pé Esquerdo" side="E" files={filesEsquerdo} setFiles={setFilesEsquerdo}/>
            </div>
            {totalArqs>0&&(
              <div style={{marginTop:10,padding:"7px 12px",background:`${C.green}08`,border:`1px solid ${C.green}22`,borderRadius:8,fontSize:11,color:C.green,fontWeight:700}}>
                ✓ {totalArqs} arquivo{totalArqs!==1?"s":""} anexado{totalArqs!==1?"s":""} — {filesDireito.length} pé direito · {filesEsquerdo.length} pé esquerdo
              </div>
            )}
          </div>

          {/* Obs gerais */}
          <div>
            <div style={{fontSize:10,color:C.accent,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",marginBottom:8}}>▸ Observações Clínicas Gerais</div>
            <textarea rows={3} value={f.obs} onChange={e=>set("obs",e.target.value)} placeholder="Diagnóstico, queixa principal, histórico relevante, orientações adicionais..."/>
          </div>

          {/* Aviso: vai para a cesta */}
          <div style={{padding:14,background:`${C.accent}07`,border:`1px solid ${C.accent}22`,borderRadius:10}}>
            <div style={{fontSize:12,fontWeight:700,color:C.text}}>🧺 Este pedido vai para a cesta</div>
            <div style={{fontSize:11,color:C.muted,marginTop:4,lineHeight:1.6}}>Adicione quantos pedidos quiser — o frete é pago <strong style={{color:C.green}}>uma única vez</strong> para toda a remessa, na hora de fechar o envio.</div>
          </div>

          {criados>0&&(
            <div style={{padding:"11px 14px",background:`${C.green}0C`,border:`1px solid ${C.green}35`,borderRadius:10,display:"flex",alignItems:"center",gap:9,animation:"fadeUp .25s ease"}}>
              <span style={{fontSize:18}}>✅</span>
              <div style={{fontSize:12,color:C.green,fontWeight:700}}>{criados} pedido{criados!==1?"s":""} já na cesta! Preencha o próximo ou conclua.</div>
            </div>
          )}

          <div style={{display:"flex",gap:8,justifyContent:"flex-end",flexWrap:"wrap"}}>
            <Btn v="ghost" onClick={onClose}>{criados>0?`Concluir (${criados} na cesta)`:"Cancelar"}</Btn>
            <Btn v="subtle" onClick={saveEoutro} disabled={!f.paciente}>➕ Criar e adicionar outro</Btn>
            <Btn v="primary" onClick={save} disabled={!f.paciente}>Criar Pedido →</Btn>
          </div>
        </div>
      </Card>
    </Modal>
  );
}

function RemessaModal({cesta,onClose,onConfirm,onAddMais}) {
  const [pagamento] = useState("faturado");
  const [frete,setFrete] = useState("sedex");
  const n = cesta.length;
  const antecipado = (PAGAMENTO_OPCOES[pagamento]||{}).antecipado;
  const itens = cesta.map(p=>({...p, valor: precoPalmilha(p.produto||p.tipo, antecipado)}));
  const subtotal = itens.reduce((a,p)=>a+p.valor,0);
  const valorFrete = (FRETE_FP[frete]||FRETE_FP["sedex"]).valor;
  const total = subtotal+valorFrete;
  const pagarDepois = !antecipado;
  const confirmar = () => onConfirm({
    ids: cesta.map(p=>p.id),
    valores: itens.reduce((m,p)=>{m[p.id]=p.valor;return m;},{}),
    pagamento, pagamentoLabel:(PAGAMENTO_OPCOES[pagamento]||{}).label||"", antecipado,
    freteLabel:(FRETE_FP[frete]||{}).label||"", freteValor:valorFrete,
    subtotal, total, pagarDepois
  });
  return (
    <Modal onClose={onClose}>
      <Card hover={false} p={0} style={{width:"94vw",maxWidth:520,maxHeight:"88vh",overflowY:"auto",animation:"slideUp .3s"}}>
        <div style={{padding:"16px 18px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontSize:16,fontWeight:800,color:C.text}}>📦 Fechar envio</div>
            <div style={{fontSize:12,color:C.muted,marginTop:2}}>{n} pedido{n!==1?"s":""} nesta remessa</div>
          </div>
          <div onClick={onClose} style={{cursor:"pointer",fontSize:20,color:C.muted}}>✕</div>
        </div>
        <div style={{padding:18,display:"flex",flexDirection:"column",gap:16}}>
          <div style={{maxHeight:140,overflowY:"auto",border:`1px solid ${C.border}`,borderRadius:9}}>
            {itens.map(p=>(
              <div key={p.id} style={{display:"flex",justifyContent:"space-between",padding:"8px 12px",borderBottom:`1px solid ${C.border}`,fontSize:12}}>
                <span style={{color:C.text}}>{p.paciente||"(sem nome)"} <span style={{color:C.muted}}>· {p.produto||p.tipo||"Palmilha"}</span></span>
                <span style={{color:C.green,fontWeight:700}}>R$ {brl(p.valor)}</span>
              </div>
            ))}
          </div>
          <div>
            <div style={{fontSize:10,color:C.accent,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",marginBottom:8}}>▸ Forma de pagamento</div>
            <div style={{padding:"11px 13px",borderRadius:9,border:`2px solid ${C.accent}`,background:`${C.accent}10`}}>
              <div style={{fontSize:12,fontWeight:700,color:C.accent}}>💳 Faturado (pagar no fechamento)</div>
              <div style={{fontSize:10,fontWeight:600,color:C.muted,marginTop:3}}>Tênis/Sapato R$ 280 · Chinelo R$ 380</div>
            </div>
            <div style={{fontSize:11,color:C.amber,marginTop:8}}>⏳ Esta remessa será cobrada no fechamento do mês.</div>
          </div>
          <div>
            <div style={{fontSize:10,color:C.accent,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",marginBottom:8}}>▸ Frete (uma vez para toda a remessa)</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {Object.entries(FRETE_FP).map(([k,o])=>(
                <div key={k} onClick={()=>setFrete(k)} style={{padding:"11px 13px",borderRadius:9,cursor:"pointer",border:`2px solid ${frete===k?C.green:C.border}`,background:frete===k?`${C.green}10`:"transparent"}}>
                  <div style={{fontSize:12,fontWeight:700,color:frete===k?C.green:C.text}}>{o.label}</div>
                  <div style={{fontSize:14,fontWeight:900,color:frete===k?C.green:C.sub,marginTop:3}}>R$ {brl(o.valor)}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{padding:14,background:`${C.green}07`,border:`1px solid ${C.green}22`,borderRadius:10}}>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:C.sub,marginBottom:5}}><span>{n} palmilha{n!==1?"s":""}</span><span>R$ {brl(subtotal)}</span></div>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:C.sub,marginBottom:8}}><span>Frete ({(FRETE_FP[frete]||{}).label})</span><span>R$ {brl(valorFrete)}</span></div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",borderTop:`1px solid ${C.green}22`,paddingTop:8}}>
              <div style={{fontSize:13,fontWeight:800,color:C.text}}>Total da remessa</div>
              <div style={{fontSize:24,fontWeight:900,color:C.green}}>R$ {brl(total)}</div>
            </div>
          </div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            <Btn v="ghost" onClick={onClose} style={{flex:1,justifyContent:"center",minWidth:110}}>Cancelar</Btn>
            {onAddMais&&<Btn v="subtle" onClick={onAddMais} style={{flex:1,justifyContent:"center",minWidth:150}}>➕ Adicionar mais um</Btn>}
            <Btn v="primary" onClick={confirmar} style={{flex:2,justifyContent:"center",minWidth:200}}>Confirmar envio · R$ {brl(total)}</Btn>
          </div>
        </div>
      </Card>
    </Modal>
  );
}

function PedidosPage({pedidos,setPedidos,isAdmin,clinicaId,clinicaName,pacientes,onRecarregar,onExcluir}) {
  const [fSt,setFSt]     = useState("Todos");
  const [fCl,setFCl]     = useState("Todas");
  const [sort,setSort]   = useState("data_desc");
  const [search,setSearch] = useState("");
  const [detail,setDetail] = useState(null);
  const [showN,setShowN] = useState(false);
  const [showRemessa,setShowRemessa] = useState(false);

  // Isolamento: clínica só vê seus próprios pedidos (por ID)
  const base = clinicaId ? pedidos.filter(p=>p.clinicaId===clinicaId) : pedidos;
  let vis = [...base];
  if(fSt!=="Todos") vis=vis.filter(p=>p.status===fSt);
  if(isAdmin&&fCl!=="Todas") vis=vis.filter(p=>p.clinica===fCl);
  if(search.trim()){ const q=search.toLowerCase(); vis=vis.filter(p=>(p.paciente||"").toLowerCase().includes(q)||(p.id||"").toLowerCase().includes(q)||(p.clinica||"").toLowerCase().includes(q)); }
  vis.sort((a,b)=>sort==="data_desc"?(b.data||"").localeCompare(a.data||""):sort==="data_asc"?(a.data||"").localeCompare(b.data||""):sort==="clinica"?(a.clinica||"").localeCompare(b.clinica||""):STATUS_FLOW.indexOf(a.status)-STATUS_FLOW.indexOf(b.status));

  const clOpts = ["Todas",...new Set(pedidos.map(p=>p.clinica).filter(Boolean))];
  const counts = STATUS_FLOW.reduce((acc,s)=>{acc[s]=base.filter(p=>p.status===s).length;return acc;},{});
  const upd = u => { setPedidos(prev=>prev.map(p=>p.id===u.id?u:p)); setDetail(u); };
  const add = p => setPedidos(prev=>[p,...prev]);
  const delPedido = (p) => {
    if(!window.confirm(`Excluir o pedido ${p.id} (${p.paciente||"sem nome"})? Esta ação não pode ser desfeita.`)) return;
    if(onExcluir) onExcluir(p.id);
    else setPedidos(prev=>prev.filter(x=>x.id!==p.id));
    setDetail(null);
  };

  // Cesta: pedidos novos ainda não enviados numa remessa (campo enviado===false explícito)
  const cesta = base.filter(p=>p.enviado===false && !p.remessaId);
  const fecharRemessa = (dados) => {
    const rid = "REM-"+Date.now().toString(36).toUpperCase();
    const idsSet = new Set(dados.ids);
    const hoje = new Date().toISOString().split("T")[0];
    setPedidos(prev=>prev.map(p=> idsSet.has(p.id) ? {
      ...p, enviado:true, remessaId:rid,
      freteLabel:dados.freteLabel, freteValor:dados.freteValor,
      pagamento:dados.pagamento, pagamentoLabel:dados.pagamentoLabel,
      antecipado:dados.antecipado, pagarDepois:dados.pagarDepois,
      valorPalmilha:(dados.valores&&dados.valores[p.id])!=null?dados.valores[p.id]:precoPalmilha(p.produto||p.tipo, dados.antecipado),
      remessaData:hoje, pago:false
    } : p));
    setShowRemessa(false);
  };

  return (
    <div style={{padding:20}}>
      <SH title="Pedidos de Palmilhas"
        sub={`${vis.length} pedido${vis.length!==1?"s":""} · ${pedidos.length} total no sistema`}
        right={
          <div style={{display:"flex",gap:8}}>
            {isAdmin&&onRecarregar&&(
              <Btn v="subtle" sz="sm" onClick={async()=>{await onRecarregar();}}>🔄 Atualizar</Btn>
            )}
            <Btn v="primary" onClick={()=>setShowN(true)}>+ Novo Pedido</Btn>
          </div>
        }
      />
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:7,marginBottom:14}}>
        {STATUS_FLOW.map(s=>{
          const sc=STATUS_CFG[s]||{color:C.sub}; const a=fSt===s;
          return (
            <button key={s} onClick={()=>setFSt(a?"Todos":s)} style={{padding:0,borderRadius:11,textAlign:"center",background:a?`linear-gradient(160deg,${sc.color}22,${sc.color}08)`:C.bgGlass,border:`1px solid ${a?sc.color+"55":C.border}`,cursor:"pointer",transition:"all .16s",outline:"none",overflow:"hidden",boxShadow:a?`0 4px 16px ${sc.color}22`:"none"}}>
              <div style={{height:3,background:a?sc.color:"transparent"}}/>
              <div style={{padding:"8px 4px"}}>
                <div style={{fontSize:15,marginBottom:1}}>{sc.icon}</div>
                <div style={{fontSize:17,fontWeight:900,color:a?sc.color:C.text}}>{counts[s]||0}</div>
                <div style={{fontSize:8,color:a?sc.color:C.muted,fontWeight:700,lineHeight:1.2,marginTop:2}}>{s}</div>
              </div>
            </button>
          );
        })}
      </div>
      <div style={{display:"flex",gap:8,marginBottom:12,padding:"10px 12px",background:C.bgGlass,borderRadius:12,border:`1px solid ${C.border}`,flexWrap:"wrap",alignItems:"center"}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍  Buscar por paciente, ID ou clínica..." style={{flex:"1 1 180px",minWidth:160}}/>
        {isAdmin&&<select value={fCl} onChange={e=>setFCl(e.target.value)} style={{flex:"0 0 175px"}}>{clOpts.map(c=><option key={c}>{c}</option>)}</select>}
        <select value={sort} onChange={e=>setSort(e.target.value)} style={{flex:"0 0 200px"}}>
          <option value="data_desc">📅 Mais recente primeiro</option>
          <option value="data_asc">📅 Mais antigo primeiro</option>
          <option value="status">⚙️ Por status (fluxo)</option>
          <option value="clinica">🏥 Por clínica (A→Z)</option>
        </select>
        {(fSt!=="Todos"||fCl!=="Todas"||search)&&<Btn v="ghost" sz="sm" onClick={()=>{setFSt("Todos");setFCl("Todas");setSearch("");}}>✕ Limpar</Btn>}
      </div>
      {cesta.length>0&&(
        <Card hover={false} p={0} style={{marginBottom:12,overflow:"hidden",border:`1px solid ${C.accent}40`}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,padding:"13px 16px",background:`${C.accent}0E`,flexWrap:"wrap"}}>
            <div style={{display:"flex",alignItems:"center",gap:11}}>
              <div style={{fontSize:22}}>🧺</div>
              <div>
                <div style={{fontSize:14,fontWeight:800,color:C.text}}>{cesta.length} pedido{cesta.length!==1?"s":""} na cesta · <span style={{color:C.green}}>~R$ {brl(cesta.reduce((a,p)=>a+precoPalmilha(p.produto||p.tipo,false),0))}</span> + frete</div>
                <div style={{fontSize:11,color:C.muted,marginTop:2}}>💡 Frete único pra remessa inteira — quanto mais pedidos juntos, menos frete por par</div>
              </div>
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <Btn v="subtle" onClick={()=>setShowN(true)}>➕ Adicionar mais</Btn>
              <Btn v="primary" onClick={()=>setShowRemessa(true)}>📦 Fechar envio →</Btn>
            </div>
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",padding:"9px 16px",borderTop:`1px solid ${C.accent}18`}}>
            {cesta.map(p=>(
              <span key={p.id} style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:10.5,fontWeight:700,color:C.sub,background:C.bgGlass,border:`1px solid ${C.border}`,borderRadius:99,padding:"3px 10px"}}>
                {/hinelo/i.test(p.produto||p.tipo||"")?"🩴":"👟"} {p.paciente||"(sem nome)"} <span style={{color:C.green}}>R$ {brl(precoPalmilha(p.produto||p.tipo,false))}</span>
              </span>
            ))}
          </div>
        </Card>
      )}
      <Card hover={false} p={0} style={{overflow:"hidden"}}>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead>
              <tr style={{borderBottom:`1px solid ${C.border}`,background:C.bgGlass}}>
                {(isAdmin?["ID","Paciente","Clínica","Palmilha","Status","Rastreio","Data",""]
                        :["ID","Paciente","Palmilha","Status","Rastreio","Data",""]).map(h=>(
                  <th key={h} style={{padding:"10px 13px",textAlign:"left",color:C.muted,fontWeight:700,fontSize:9,letterSpacing:".07em",textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vis.length===0&&<tr><td colSpan={8} style={{padding:40,textAlign:"center",color:C.muted}}>{isAdmin?"Nenhum pedido encontrado no sistema.":"Sua clínica ainda não possui pedidos. Clique em + Novo Pedido para começar."}</td></tr>}
              {vis.map(p=>{
                const hr=!!p.rastreio;
                return (
                  <tr key={p.id} style={{borderBottom:`1px solid ${C.border}`,transition:"background .12s",cursor:"pointer"}} onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,.02)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"} onClick={()=>setDetail(p)}>
                    <td style={{padding:"11px 13px"}}><span style={{fontFamily:"'Space Mono',monospace",fontSize:10,color:C.accent,fontWeight:700}}>{p.id}</span></td>
                    <td style={{padding:"11px 13px",fontWeight:600}}><span style={{display:"inline-flex",alignItems:"center",gap:9}}><span style={{width:28,height:28,borderRadius:9,background:`linear-gradient(135deg,${C.accent}30,${C.purple}25)`,border:`1px solid ${C.accent}25`,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:900,color:C.soft,flexShrink:0}}>{(p.paciente||"?").charAt(0).toUpperCase()}</span>{p.paciente}</span></td>
                    {isAdmin&&<td style={{padding:"11px 13px",color:C.muted,fontSize:12}}>{p.clinica}</td>}
                    <td style={{padding:"11px 13px",color:C.sub,fontSize:12}}>{p.tipoPalmilha||p.tipo}</td>
                    <td style={{padding:"11px 13px"}}><SBadge status={p.status}/></td>
                    <td style={{padding:"11px 13px"}}>{hr?<a href={`https://rastreamento.correios.com.br/app/index.php?objetos=${p.rastreio}`} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} style={{display:"inline-flex",alignItems:"center",gap:4,padding:"3px 8px",borderRadius:6,fontSize:10,fontWeight:700,background:`${C.green}13`,color:C.green,textDecoration:"none",border:`1px solid ${C.green}28`}}>🔗 {p.rastreio.slice(0,9)}…</a>:<span style={{fontSize:11,color:C.muted}}>—</span>}</td>
                    <td style={{padding:"11px 13px",color:C.muted,fontSize:11,whiteSpace:"nowrap"}}>{fmtD(p.data)}</td>
                    <td style={{padding:"11px 13px"}} onClick={e=>e.stopPropagation()}><div style={{display:"flex",gap:6}}><Btn v="ghost" sz="sm" onClick={()=>setDetail(p)}>{isAdmin?"✏️ Editar":"👁 Ver"}</Btn>{isAdmin&&<Btn v="ghost" sz="sm" onClick={()=>delPedido(p)} style={{color:C.red}}>🗑️</Btn>}</div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {detail&&<PedidoModal pedido={detail} isAdmin={isAdmin} onClose={()=>setDetail(null)} onUpdate={upd}/>}
      {showN&&<NovoPedidoModal onClose={()=>setShowN(false)} onSave={add} pacientes={pacientes} clinicaName={clinicaName} clinicaId={clinicaId}/>}
      {showRemessa&&<RemessaModal cesta={cesta} onClose={()=>setShowRemessa(false)} onConfirm={fecharRemessa} onAddMais={()=>{setShowRemessa(false);setShowN(true);}}/>}
    </div>
  );
}

// ─── CLÍNICAS ──────────────────────────────────────────────────────────────────
function EliteAdminPanel({clinicas}) {
  const [aberto,setAberto] = useState(false);
  const [tick,setTick] = useState(0);
  const getConv = (nome) => { const v = LS.read("fp:elite:"+(nome||"default")); return (v&&typeof v.conv==="number")?v.conv:0; };
  const setConv = (nome,val) => { const n = Math.max(0,val); LS.write("fp:elite:"+(nome||"default"),{conv:n}); setTick(t=>t+1); };
  const totalConv = clinicas.reduce((s,c)=>s+getConv(c.nome),0);
  return (
    <Card hover={false} p={0} style={{overflow:"hidden",border:`1px solid ${C.gold}30`,marginBottom:16}}>
      <div onClick={()=>setAberto(a=>!a)} style={{padding:"14px 18px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",background:`linear-gradient(135deg,${C.gold}10,${C.purple}06)`}}>
        <div>
          <div style={{fontSize:14,fontWeight:800}}>👑 Programa Elite — Gestão de Indicações</div>
          <div style={{fontSize:11,color:C.muted,marginTop:2}}>Confirme as indicações convertidas e credite as clínicas manualmente.</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{textAlign:"right"}}><div style={{fontSize:18,fontWeight:900,color:C.gold}}>{totalConv}</div><div style={{fontSize:9,color:C.muted}}>conversões</div></div>
          <span style={{fontSize:16,color:C.muted}}>{aberto?"▲":"▼"}</span>
        </div>
      </div>
      {aberto && (
        <div style={{padding:16,borderTop:`1px solid ${C.border}`}}>
          {clinicas.length===0 ? <div style={{textAlign:"center",color:C.muted,padding:20,fontSize:12}}>Nenhuma clínica cadastrada.</div> : (
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {clinicas.map((c,i)=>{ const conv=getConv(c.nome); const cred=conv*2; return (
                <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,padding:"10px 12px",background:C.bgGlass,border:`1px solid ${C.border}`,borderRadius:9,flexWrap:"wrap"}}>
                  <div style={{minWidth:140,flex:1}}>
                    <div style={{fontSize:12.5,fontWeight:700}}>🏥 {c.nome}</div>
                    <div style={{fontSize:10.5,color:C.muted}}>{conv} indicação(ões) · <span style={{color:C.green,fontWeight:700}}>{cred} créditos de palmilha</span>{c.indicadoPorNome&&<> · <span style={{color:C.gold,fontWeight:700}}>👑 indicada por {c.indicadoPorNome}</span></>}</div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <Btn v="ghost" sz="sm" onClick={()=>setConv(c.nome,conv-1)}>−</Btn>
                    <span style={{minWidth:28,textAlign:"center",fontSize:15,fontWeight:900,color:C.gold}}>{conv}</span>
                    <Btn v="primary" sz="sm" onClick={()=>setConv(c.nome,conv+1)}>+1 indicação</Btn>
                  </div>
                </div>
              ); })}
            </div>
          )}
          <div style={{marginTop:12,fontSize:10.5,color:C.muted,fontStyle:"italic",lineHeight:1.5}}>Cada indicação convertida = 2 créditos de palmilha para a clínica. Confirme apenas quando o indicado ativar o Plano Enterprise de verdade. A clínica vê o crédito na aba Elite dela.</div>
        </div>
      )}
    </Card>
  );
}

function ClinicasPage({clinicas,setClinicas}) {
  const [search,setSearch] = useState("");
  const [show,setShow]     = useState(false);
  const [edit,setEdit]     = useState(null);
  const [showSenha,setShowSenha]   = useState(false);
  const [showConfirm,setShowConfirm] = useState(false);
  const [formErr,setFormErr] = useState("");
  const [confirmDel,setConfirmDel] = useState(null);
  const [expandedId,setExpandedId] = useState(null);
  const [senhaGerada,setSenhaGerada] = useState("");
  const [solicitacoes,setSolicitacoes] = useState(()=>LS.read("fp:solicitacoes")||[]);
  useEffect(()=>{ (async()=>{ const s=await LS.readAsync("fp:solicitacoes"); if(s) setSolicitacoes(s); })(); },[]);
  const removerSolic = (id) => { const n=solicitacoes.filter(s=>s.id!==id); setSolicitacoes(n); LS.write("fp:solicitacoes",n); };
  const [solicAprovando,setSolicAprovando] = useState(null);

  const emptyF = {nome:"",cnpj:"",cpf:"",resp:"",email:"",tel:"",cep:"",rua:"",numero:"",complemento:"",bairro:"",cidade:"",estado:"",plano:"Básico",statusManual:"",dataAtivacao:"",dataVencimento:"",senha:"",confirmarSenha:""};
  const [f,setF] = useState(emptyF);
  const sf = (k,v) => { setF(prev=>({...prev,[k]:v})); setFormErr(""); };

  const vis = clinicas.filter(c=>{
    const termo = (search||"").toLowerCase().trim();
    if(!termo) return true;
    const nome = (c.nome||"").toLowerCase();
    const mail = (c.email||"").toLowerCase();
    const resp = (c.resp||"").toLowerCase();
    return nome.includes(termo) || mail.includes(termo) || resp.includes(termo);
  });

  const gerarSenha = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#!";
    let s = "";
    for(let i=0;i<10;i++) s+=chars[Math.floor(Math.random()*chars.length)];
    const senha = s+"@"+Math.floor(10+Math.random()*89);
    sf("senha",senha); sf("confirmarSenha",senha);
    setSenhaGerada(senha);
  };

  const openEdit = c => { setF({...c,senha:"",confirmarSenha:""}); setEdit(c); setSenhaGerada(""); setFormErr(""); setShow(true); };
  const openNew  = () => { setF(emptyF); setEdit(null); setSenhaGerada(""); setFormErr(""); setShow(true); };

  const save = async () => {
    if(!f.nome.trim()||!f.email.trim()) { setFormErr("Nome e e-mail são obrigatórios."); return; }
    if(!edit && !f.senha) { setFormErr("Defina uma senha para a clínica."); return; }
    if(f.senha && f.senha!==f.confirmarSenha) { setFormErr("As senhas não coincidem."); return; }
    if(f.senha && f.senha.length<6) { setFormErr("A senha deve ter no mínimo 6 caracteres."); return; }
    const emailExiste = clinicas.find(c=>(c.email||"").trim().toLowerCase()===f.email.trim().toLowerCase()&&c.id!==edit?.id);
    if(emailExiste) { setFormErr("Este e-mail já está cadastrado para outra clínica."); return; }
    // 🔐 a senha vira impressão digital; o texto nunca é gravado
    const cred = f.senha ? await SENHA_FP.criar(f.senha) : {};
    const limpo = { ...f }; delete limpo.senha; delete limpo.confirmarSenha;
    if(edit) {
      setClinicas(p=>p.map(c=>{ if(c.id!==edit.id) return c; const nx={...c,...limpo,...cred}; if(f.senha) delete nx.senha; return nx; }));
    } else {
      // Se está aprovando uma solicitação que veio indicada (Elite), herda a indicação e lembra o admin de creditar
      const solicObj = solicAprovando!=null ? (solicitacoes||[]).find(x=>x.id===solicAprovando) : null;
      const heranca = (solicObj && solicObj.indicadoPor) ? { indicadoPor: solicObj.indicadoPor, indicadoPorNome: solicObj.indicadoPorNome||"" } : {};
      setClinicas(p=>[...p,{id:Date.now(),pedidos:0,trialInicio:new Date().toISOString(),...limpo,...cred,...heranca}]);
      if(solicObj && solicObj.indicadoPor){
        pushNotif("admin:master","👑","Lembrete Elite: indicação a creditar",`${f.nome} foi indicada por ${solicObj.indicadoPorNome||solicObj.indicadoPor}. Quando ela ativar o Enterprise, clique em "+1 indicação" no painel Elite para creditar a indicadora.`,"clinicas");
      }
    }
    setShow(false); setEdit(null); setSenhaGerada("");
    if(solicAprovando!=null){ removerSolic(solicAprovando); setSolicAprovando(null); }
  };

  const toggle = (id,k,v) => setClinicas(p=>p.map(c=>c.id===id?{...c,[k]:v}:c));
  const toggleDiretorio = (c) => {
    const ligar = !c.mostrarDiretorio;
    toggle(c.id,"mostrarDiretorio",ligar);
    if(ligar) pushNotif("clinica:"+c.id,"🗺️","Sua clínica entrou no diretório público! 🎉","Pacientes da sua região agora encontram a clínica na página \"Encontre uma clínica FisioPiede\" e podem chamar direto no WhatsApp.","dashboard");
  };
  const del = id => { setClinicas(p=>p.filter(c=>c.id!==id)); setConfirmDel(null); };

  return (
    <div style={{padding:20}}>
      <SH title="Clínicas Licenciadas" sub="Gerencie os acessos das clínicas parceiras"
        right={<div style={{display:"flex",gap:8}}><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar clínica..." style={{width:200}}/><Btn v="primary" onClick={openNew}>+ Nova Clínica</Btn></div>}/>

      <EliteAdminPanel clinicas={clinicas}/>

      {(()=>{
        const calc = clinicas.map(c=>({c, a:ASSINATURA.calcular(c)}));
        const ativas = calc.filter(x=>x.a.status==="Ativa").length;
        const atraso = calc.filter(x=>x.a.status==="Em atraso").length;
        const suspCanc = calc.filter(x=>x.a.status==="Suspensa"||x.a.status==="Cancelada").length;
        // MRR: Premium mensal = 89,90; Enterprise R$ 2.998/ano (12x 249,90) => contribui 249,90/mês
        const mrr = calc.filter(x=>x.a.status==="Ativa"||x.a.status==="Em atraso").reduce((s,x)=>{
          if(x.c.plano==="Premium") return s+89.90;
          if(x.c.plano==="Enterprise") return s+249.90;
          return s;
        },0);
        const arr = mrr*12;
        const fmt = (n)=>"R$ "+n.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
        const cards=[
          {l:"Aguardando aprovação",v:String(solicitacoes.length),c:C.amber,destaque:solicitacoes.length>0},
          {l:"Total de clínicas",v:String(clinicas.length),c:C.accent},
          {l:"Ativas",v:String(ativas),c:C.green},
          {l:"Em atraso",v:String(atraso),c:"#F97316"},
          {l:"Susp./Cancel.",v:String(suspCanc),c:C.red},
          {l:"MRR (receita/mês)",v:fmt(mrr),c:C.purple},
          {l:"ARR (receita/ano)",v:fmt(arr),c:C.gold},
        ];
        return (
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:16}}>
            {cards.map((s,i)=>(
              <Card key={i} p={14} style={{display:"flex",flexDirection:"column",gap:4,border:s.destaque?`1px solid ${C.amber}55`:undefined,background:s.destaque?`${C.amber}0C`:undefined}}>
                <span style={{fontSize:11,color:C.muted}}>{s.destaque?"📩 ":""}{s.l}</span>
                <span style={{fontSize:s.v.length>8?17:21,fontWeight:900,color:s.c}}>{s.v}</span>
              </Card>
            ))}
          </div>
        );
      })()}

      {solicitacoes.length>0 && (
        <Card hover={false} p={18} style={{marginBottom:16,border:`1px solid ${C.amber}30`,background:`${C.amber}06`}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
            <span style={{fontSize:18}}>📩</span>
            <span style={{fontWeight:800,fontSize:14}}>Solicitações de acesso</span>
            <Badge label={`${solicitacoes.length} pendente(s)`} color={C.amber}/>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {solicitacoes.map(s=>(
              <div key={s.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 12px",background:C.bgGlass,borderRadius:9,border:`1px solid ${C.border}`,flexWrap:"wrap"}}>
                <div style={{flex:1,minWidth:200}}>
                  <div style={{fontWeight:700,fontSize:13}}>{s.clinica}</div>
                  <div style={{fontSize:11,color:C.muted,lineHeight:1.5}}>{s.responsavel?s.responsavel+" · ":""}{s.email}{s.telefone?" · "+s.telefone:""}</div>
                  <div style={{fontSize:10,color:C.muted,marginTop:2}}>{s.cnpj?"CNPJ "+s.cnpj+" · ":""}{[s.rua,s.numero,s.bairro,s.cidade,s.estado].filter(Boolean).join(", ")}</div>
                  {s.indicadoPor && <div style={{fontSize:10.5,fontWeight:800,color:C.gold,marginTop:4,display:"inline-flex",alignItems:"center",gap:5,background:`${C.gold}12`,border:`1px solid ${C.gold}30`,borderRadius:99,padding:"2px 9px"}}>👑 Indicado por: {s.indicadoPorNome||s.indicadoPor}</div>}
                </div>
                <span style={{fontSize:10,color:C.muted}}>{new Date(s.data).toLocaleDateString("pt-BR")}</span>
                <div style={{display:"flex",gap:6}}>
                  <Btn v="success" sz="sm" onClick={()=>{ setF({...emptyF,nome:s.clinica,cnpj:s.cnpj||"",cpf:s.cpf||"",resp:s.responsavel||"",email:s.email||"",tel:s.telefone||"",cep:s.cep||"",rua:s.rua||"",numero:s.numero||"",complemento:s.complemento||"",bairro:s.bairro||"",cidade:s.cidade||"",estado:s.estado||""}); setEdit(null); setSolicAprovando(s.id); setShow(true); }}>✓ Aprovar e cadastrar</Btn>
                  <Btn v="ghost" sz="sm" onClick={()=>{ if(window.confirm(`Tem certeza que deseja recusar a solicitação de "${s.clinica}"? Esta ação não pode ser desfeita.`)) removerSolic(s.id); }}>Recusar</Btn>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {clinicas.length===0
        ? <Card hover={false} p={40} style={{textAlign:"center"}}><div style={{fontSize:48,marginBottom:12}}>🏥</div><div style={{fontSize:15,fontWeight:700,marginBottom:6}}>Nenhuma clínica cadastrada</div><div style={{fontSize:12,color:C.muted,marginBottom:16}}>Clique em "+ Nova Clínica" para adicionar a primeira clínica parceira</div><Btn v="primary" onClick={openNew} style={{margin:"0 auto"}}>+ Cadastrar Primeira Clínica</Btn></Card>
        : <Card hover={false} p={0} style={{overflow:"hidden"}}>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                <thead>
                  <tr style={{borderBottom:`1px solid ${C.border}`}}>
                    {["Clínica","Contato","Responsável / CNPJ","Pedidos","Faturamento","Plano","Status","Ações"].map(h=>(
                      <th key={h} style={{padding:"10px 14px",textAlign:"left",color:C.muted,fontWeight:700,fontSize:9,letterSpacing:".06em",textTransform:"uppercase"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {vis.map(c=>(
                    <React.Fragment key={c.id}>
                      <tr style={{borderBottom:expandedId===c.id?"none":`1px solid ${C.border}`,transition:"background .12s",cursor:"pointer"}} onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,.02)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"} onClick={()=>setExpandedId(expandedId===c.id?null:c.id)}>
                        <td style={{padding:"11px 14px"}}><div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:28,height:28,borderRadius:7,background:`linear-gradient(135deg,${C.accent}30,${C.purple}30)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13}}>🏥</div><div><div style={{fontWeight:700}}>{c.nome||c.resp||c.email||"(clínica sem nome)"}</div>{(c.cidade||c.estado)&&<div style={{fontSize:10,color:C.muted}}>{[c.cidade,c.estado].filter(Boolean).join("/")}</div>}</div></div></td>
                        <td style={{padding:"11px 14px",color:C.sub,fontSize:12}}><div>{c.email}</div>{c.tel&&<div style={{fontSize:10,color:C.muted}}>{c.tel}</div>}</td>
                        <td style={{padding:"11px 14px",color:C.sub,fontSize:12}}><div>{c.resp}</div>{c.cnpj&&<div style={{fontSize:9,color:C.muted,fontFamily:"'Space Mono',monospace"}}>{c.cnpj}</div>}</td>
                        <td style={{padding:"11px 14px",fontWeight:700}}>{c.pedidosReal??c.pedidos??0}</td>
                        <td style={{padding:"11px 14px",color:C.green,fontWeight:800}}>R$ {brl((c.pedidosReal??c.pedidos??0)*PRECO)}</td>
                        <td style={{padding:"11px 14px"}}><Badge label={c.plano} color={c.plano==="Premium"?C.purple:C.sub}/></td>
                        <td style={{padding:"11px 14px"}}>{(()=>{const a=ASSINATURA.calcular(c); return <Badge label={a.status} color={ASSINATURA.cor(a.status)}/>;})()}</td>
                        <td style={{padding:"11px 14px"}}>
                          <div style={{display:"flex",gap:4}}>
                            <Btn v="ghost" sz="sm" onClick={e=>{e.stopPropagation();openEdit(c);}}>✏️</Btn>
                            <Btn v="ghost" sz="sm" onClick={e=>{e.stopPropagation();toggleDiretorio(c);}} style={c.mostrarDiretorio?{border:`1px solid ${C.green}55`,background:`${C.green}10`}:{opacity:.5}}>🗺️</Btn>
                            <Btn v="ghost" sz="sm" onClick={e=>{e.stopPropagation();toggle(c.id,"statusManual",c.statusManual==="Suspensa"?"":"Suspensa");}}>{c.statusManual==="Suspensa"?"🔓":"🔒"}</Btn>
                            <Btn v="danger" sz="sm" onClick={e=>{e.stopPropagation();setConfirmDel(c);}}>🗑️</Btn>
                          </div>
                        </td>
                      </tr>
                      {expandedId===c.id&&(
                        <tr style={{borderBottom:`1px solid ${C.border}`}}>
                          <td colSpan={8} style={{padding:"0 14px 14px 14px",background:"rgba(255,255,255,.015)"}}>
                            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,paddingTop:12}}>
                              {[
                                ["📄 CNPJ",c.cnpj||"—"],
                                ["🪪 CPF Resp.",c.cpf||"—"],
                                ["📍 CEP",c.cep||"—"],
                                ["🏠 Endereço",c.rua?`${c.rua}, ${c.numero}${c.complemento?" — "+c.complemento:""}`:"—"],
                                ["🏘️ Bairro",c.bairro||"—"],
                                ["🌆 Cidade",c.cidade||"—"],
                                ["🗺️ Estado",c.estado||"—"],
                                ["📞 Telefone",c.tel||"—"],
                              ].map(([label,val])=>(
                                <div key={label} style={{padding:"8px 10px",background:C.bgGlass,border:`1px solid ${C.border}`,borderRadius:8}}>
                                  <div style={{fontSize:9,color:C.muted,fontWeight:700,marginBottom:2}}>{label}</div>
                                  <div style={{fontSize:11,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{val}</div>
                                </div>
                              ))}
                            </div>
                            <div style={{marginTop:12,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,padding:"11px 14px",background:c.mostrarDiretorio?`${C.green}08`:C.bgGlass,border:`1px solid ${c.mostrarDiretorio?C.green+"30":C.border}`,borderRadius:10,flexWrap:"wrap"}}>
                              <div style={{fontSize:11.5,color:C.sub,lineHeight:1.5}}>
                                <strong style={{color:C.text}}>🗺️ Diretório público "Encontre uma clínica"</strong><br/>
                                {c.mostrarDiretorio?<span style={{color:C.green,fontWeight:700}}>✓ Visível — esta clínica aparece na página pública e pode receber pacientes.</span>:"Oculta — esta clínica não aparece na página pública (?encontre)."}
                              </div>
                              <Btn v={c.mostrarDiretorio?"success":"outline"} sz="sm" onClick={e=>{e.stopPropagation();toggleDiretorio(c);}}>{c.mostrarDiretorio?"Ocultar do diretório":"🗺️ Exibir no diretório"}</Btn>
                            </div>
                            {/* Bloco de assinatura */}
                            {c.plano && c.plano!=="Básico" && (()=>{
                              const a = ASSINATURA.calcular(c);
                              const valor = c.plano==="Premium" ? 89.90 : 2998;
                              const ciclo = c.plano==="Premium" ? "mensal" : "anual (12x)";
                              const fmtData = (d)=> d ? new Date(d).toLocaleDateString("pt-BR") : "—";
                              return (
                                <div style={{marginTop:12,padding:"12px 14px",background:`${ASSINATURA.cor(a.status)}08`,border:`1px solid ${ASSINATURA.cor(a.status)}25`,borderRadius:10}}>
                                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                                    <span style={{fontSize:13,fontWeight:800}}>💳 Assinatura {c.plano}</span>
                                    <Badge label={a.status} color={ASSINATURA.cor(a.status)}/>
                                    <span style={{fontSize:11,color:C.muted}}>R$ {brl(valor)}/{ciclo}</span>
                                  </div>
                                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:10}}>
                                    <div><div style={{fontSize:9,color:C.muted,fontWeight:700}}>ATIVAÇÃO</div><div style={{fontSize:12,fontWeight:600}}>{fmtData(c.dataAtivacao)}</div></div>
                                    <div><div style={{fontSize:9,color:C.muted,fontWeight:700}}>VENCIMENTO</div><div style={{fontSize:12,fontWeight:600}}>{fmtData(c.dataVencimento)}</div></div>
                                    <div><div style={{fontSize:9,color:C.muted,fontWeight:700}}>DIAS RESTANTES</div><div style={{fontSize:12,fontWeight:700,color:a.diasRestantes!==null&&a.diasRestantes<=7?C.amber:C.text}}>{a.diasRestantes!==null?`${a.diasRestantes} dia(s)`:"—"}</div></div>
                                  </div>
                                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                                    <Btn v="success" sz="sm" onClick={(e)=>{e.stopPropagation();
                                      const msg = `Olá ${c.resp||c.nome}! 👋\n\nSegue a cobrança da sua assinatura *FisioPiede ${c.plano}*:\n\n💰 Valor: R$ ${brl(valor)} (${ciclo})\n📅 Vencimento: ${fmtData(c.dataVencimento)}\n\n*Pague via PIX:*\n🔑 Chave PIX: ${PIX_FP}\n\nApós o pagamento, envie o comprovante por aqui para liberarmos/renovarmos seu acesso. Qualquer dúvida, estou à disposição! 🦶✨`;
                                      const tel = (c.tel||"").replace(/\D/g,"");
                                      const telFull = tel.length>=10 ? ("55"+tel) : "";
                                      window.open(`https://wa.me/${telFull}?text=${encodeURIComponent(msg)}`,"_blank");
                                    }}>📤 Gerar cobrança (PIX/WhatsApp)</Btn>
                                    <Btn v="outline" sz="sm" onClick={(e)=>{e.stopPropagation();
                                      const novoVenc = ASSINATURA.calcularVencimento(c.plano, new Date().toISOString().slice(0,10)).slice(0,10);
                                      toggle(c.id,"dataVencimento",novoVenc);
                                      toggle(c.id,"statusManual","");
                                    }}>🔄 Renovar (+{c.plano==="Enterprise"?"12 meses":"1 mês"})</Btn>
                                  </div>
                                  <div style={{fontSize:10,color:C.muted,marginTop:8,lineHeight:1.5}}>💡 O link de pagamento automático (cartão/PIX/recorrência) chega na próxima etapa com o Stripe. Por enquanto, a cobrança é enviada por WhatsApp com sua chave PIX.</div>
                                </div>
                              );
                            })()}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
      }

      {/* Modal confirmar exclusão */}
      {confirmDel&&(
        <Modal onClose={()=>setConfirmDel(null)}>
          <Card hover={false} p={28} style={{width:"100%",maxWidth:420,animation:"fadeUp .22s ease"}}>
            <div style={{textAlign:"center",marginBottom:20}}>
              <div style={{fontSize:48,marginBottom:12}}>🗑️</div>
              <div style={{fontSize:17,fontWeight:900,marginBottom:8}}>Excluir Clínica?</div>
              <div style={{marginTop:12,padding:"10px 16px",background:`${C.red}10`,border:`1px solid ${C.red}25`,borderRadius:10}}>
                <div style={{fontWeight:800,fontSize:14,color:C.red}}>{confirmDel.nome}</div>
                <div style={{fontSize:12,color:C.muted,marginTop:3}}>{confirmDel.email}</div>
              </div>
              <div style={{marginTop:12,fontSize:12,color:C.red}}>⚠️ Esta ação não pode ser desfeita.</div>
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"center"}}>
              <Btn v="ghost" onClick={()=>setConfirmDel(null)} style={{flex:1,justifyContent:"center"}}>Cancelar</Btn>
              <Btn v="danger" onClick={()=>del(confirmDel.id)} style={{flex:1,justifyContent:"center"}}>Excluir Definitivamente</Btn>
            </div>
          </Card>
        </Modal>
      )}

      {/* Modal cadastro/edição */}
      {show&&(
        <Modal onClose={()=>setShow(false)}>
          <Card hover={false} p={0} style={{width:"100%",maxWidth:560,maxHeight:"92vh",overflowY:"auto",animation:"fadeUp .25s ease"}}>
            <div style={{padding:"16px 20px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",background:`linear-gradient(135deg,${C.accent}07,${C.purple}04)`}}>
              <div>
                <div style={{fontSize:16,fontWeight:800}}>{edit?"Editar Clínica":"Nova Clínica"}</div>
                <div style={{fontSize:11,color:C.muted,marginTop:2}}>{edit?"Atualize os dados e senha de acesso":"Preencha os dados e defina a senha de acesso"}</div>
              </div>
              <button onClick={()=>setShow(false)} style={{background:"none",color:C.muted,fontSize:18}}>✕</button>
            </div>
            <div style={{padding:20,display:"flex",flexDirection:"column",gap:16}}>

              {/* Dados da clínica */}
              <div>
                <div style={{fontSize:10,color:C.accent,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",marginBottom:10}}>▸ Dados da Clínica</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                  <div style={{gridColumn:"1 / -1"}}><label>Nome da Clínica *</label><input value={f.nome||""} onChange={e=>sf("nome",e.target.value)} placeholder="Ex.: Clínica Fisio São Paulo"/></div>
                  <div><label>CNPJ</label><input value={f.cnpj||""} onChange={e=>sf("cnpj",e.target.value)} placeholder="00.000.000/0001-00"/></div>
                  <div><label>CPF do Responsável</label><input value={f.cpf||""} onChange={e=>sf("cpf",e.target.value)} placeholder="000.000.000-00"/></div>
                  <div><label>Responsável</label><input value={f.resp||""} onChange={e=>sf("resp",e.target.value)} placeholder="Dr. Nome Sobrenome"/></div>
                  <div><label>Telefone / WhatsApp</label><input value={f.tel||""} onChange={e=>sf("tel",e.target.value)} placeholder="(00) 00000-0000"/></div>
                  <div><label>Plano</label><select value={f.plano||"Básico"} onChange={e=>{const novoPlano=e.target.value; sf("plano",novoPlano); if(novoPlano!=="Básico"){const ativ=f.dataAtivacao||new Date().toISOString().slice(0,10); sf("dataAtivacao",ativ); sf("dataVencimento",ASSINATURA.calcularVencimento(novoPlano, ativ).slice(0,10));}}}><option>Básico</option><option>Premium</option><option>Enterprise</option></select></div>
                  <div><label>Status da assinatura</label><select value={f.statusManual||"Automático"} onChange={e=>sf("statusManual",e.target.value==="Automático"?"":e.target.value)}><option>Automático</option><option>Pendente</option><option>Suspensa</option><option>Cancelada</option></select></div>
                  {f.plano!=="Básico" && <>
                    <div><label>Data de ativação</label><input type="date" value={(f.dataAtivacao||"").slice(0,10)} onChange={e=>{sf("dataAtivacao",e.target.value); if(f.plano&&f.plano!=="Básico") sf("dataVencimento",ASSINATURA.calcularVencimento(f.plano, e.target.value).slice(0,10));}}/></div>
                    <div><label>Vence em {f.plano==="Enterprise"?"(anual)":"(mensal)"}</label><input type="date" value={(f.dataVencimento||"").slice(0,10)} onChange={e=>sf("dataVencimento",e.target.value)}/></div>
                  </>}
                </div>
              </div>

              {/* Endereço */}
              <div>
                <div style={{fontSize:10,color:C.accent,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",marginBottom:10}}>▸ Endereço</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
                  <div><label>CEP</label><input value={f.cep||""} onChange={e=>sf("cep",e.target.value)} placeholder="00000-000"/></div>
                  <div style={{gridColumn:"2 / -1"}}><label>Rua / Logradouro</label><input value={f.rua||""} onChange={e=>sf("rua",e.target.value)} placeholder="Rua, Avenida, Travessa..."/></div>
                  <div><label>Número</label><input value={f.numero||""} onChange={e=>sf("numero",e.target.value)} placeholder="Ex.: 123"/></div>
                  <div><label>Complemento</label><input value={f.complemento||""} onChange={e=>sf("complemento",e.target.value)} placeholder="Sala 201, Bloco B..."/></div>
                  <div><label>Bairro</label><input value={f.bairro||""} onChange={e=>sf("bairro",e.target.value)} placeholder="Nome do bairro"/></div>
                  <div><label>Cidade</label><input value={f.cidade||""} onChange={e=>sf("cidade",e.target.value)} placeholder="São Paulo"/></div>
                  <div><label>Estado</label><input value={f.estado||""} onChange={e=>sf("estado",e.target.value)} placeholder="SP" style={{textTransform:"uppercase"}}/></div>
                </div>
              </div>

              {/* Acesso */}
              <div style={{background:`${C.accent}04`,border:`1px solid ${C.accent}15`,borderRadius:11,padding:14}}>
                <div style={{fontSize:10,color:C.accent,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",marginBottom:12}}>▸ Acesso ao Sistema</div>
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  <div>
                    <label>E-mail de Acesso *</label>
                    <input value={f.email||""} onChange={e=>sf("email",e.target.value)} placeholder="clinica@email.com.br" type="email"/>
                    <div style={{fontSize:10,color:C.muted,marginTop:4}}>Este e-mail será usado para login na plataforma</div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    <div>
                      <label>{edit?"Nova Senha (deixe em branco para manter)":"Senha *"}</label>
                      <div style={{position:"relative"}}>
                        <input value={f.senha||""} onChange={e=>sf("senha",e.target.value)} placeholder="••••••••" type={showSenha?"text":"password"}/>
                        <button onClick={()=>setShowSenha(!showSenha)} style={{position:"absolute",right:11,top:"50%",transform:"translateY(-50%)",background:"none",color:C.muted,fontSize:13}}>{showSenha?"🙈":"👁"}</button>
                      </div>
                    </div>
                    <div>
                      <label>Confirmar Senha</label>
                      <div style={{position:"relative"}}>
                        <input value={f.confirmarSenha||""} onChange={e=>sf("confirmarSenha",e.target.value)} placeholder="••••••••" type={showConfirm?"text":"password"}/>
                        <button onClick={()=>setShowConfirm(!showConfirm)} style={{position:"absolute",right:11,top:"50%",transform:"translateY(-50%)",background:"none",color:C.muted,fontSize:13}}>{showConfirm?"🙈":"👁"}</button>
                      </div>
                    </div>
                  </div>
                  {/* Confirmação visual de match */}
                  {f.senha&&f.confirmarSenha&&(
                    <div style={{fontSize:11,fontWeight:700,color:f.senha===f.confirmarSenha?C.green:C.red}}>
                      {f.senha===f.confirmarSenha?"✓ Senhas coincidem":"✕ Senhas não coincidem"}
                    </div>
                  )}
                  {/* Botão gerar senha */}
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <Btn v="outline" sz="sm" onClick={gerarSenha}>⚡ Gerar Senha Aleatória</Btn>
                    {senhaGerada&&(
                      <div style={{flex:1,padding:"6px 12px",background:`${C.green}10`,border:`1px solid ${C.green}28`,borderRadius:8,fontSize:12,fontFamily:"'Space Mono',monospace",color:C.green,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
                        <span>{senhaGerada}</span>
                        <button onClick={()=>{navigator.clipboard?.writeText(senhaGerada);}} style={{background:"none",color:C.green,fontSize:11,padding:0,fontWeight:700}}>📋 Copiar</button>
                      </div>
                    )}
                  </div>
                  <div style={{fontSize:10,color:C.muted,padding:"7px 10px",background:C.bgGlass,borderRadius:7,border:`1px solid ${C.border}`}}>
                    💡 Compartilhe o e-mail e senha com a clínica para que ela possa acessar a plataforma
                  </div>
                </div>
              </div>

              {formErr&&<div style={{padding:"10px 13px",background:`${C.red}10`,border:`1px solid ${C.red}28`,borderRadius:8,fontSize:12,color:C.red,fontWeight:600}}>⚠️ {formErr}</div>}

              <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                <Btn v="ghost" onClick={()=>setShow(false)}>Cancelar</Btn>
                <Btn v="primary" onClick={save}>{edit?"Salvar Alterações":"Cadastrar Clínica →"}</Btn>
              </div>
            </div>
          </Card>
        </Modal>
      )}
    </div>
  );
}


// ─── FINANCEIRO ────────────────────────────────────────────────────────────────
function FinanceiroPage({clinicas,isAdmin,clinicaObj,meusPedidos}) {
  const clinicaName = clinicaObj?.nome||null;
  const clinicaPedidos = meusPedidos ? meusPedidos.length : 0;
  // Faturamento real da clínica: valor de cada palmilha (por tipo/pagamento)
  // + fretes (uma vez por remessa). Pedido ainda na cesta não conta.
  const fretesRemessaFin = {};
  (meusPedidos||[]).forEach(p=>{ if(p.remessaId && p.freteValor!=null) fretesRemessaFin[p.remessaId]=p.freteValor; });
  const fatPalmilhas = meusPedidos ? meusPedidos.reduce((a,p)=> a + (p.valorPalmilha!=null ? p.valorPalmilha : (p.enviado===false ? 0 : PRECO)), 0) : 0;
  const fatFretes = Object.values(fretesRemessaFin).reduce((a,v)=>a+Number(v||0),0);
  const fatClinica = fatPalmilhas + fatFretes;
  const list = isAdmin ? clinicas : (clinicaObj ? [{...clinicaObj, pedidos:clinicaPedidos, fatReal:fatClinica}] : []);
  const [pagar,setPagar] = useState(null);
  const [baixa,setBaixa] = useState(null);
  const [pagos,setPagos] = useState(() => LS.read("fp:pagamentos") || {});
  // Aceita o formato antigo (n[nome]=timestamp) e o novo (n[nome]={ts,forma})
  const marcarPago = (nome, forma) => { const n={...pagos,[nome]:{ts:Date.now(),forma:forma||"PIX"}}; setPagos(n); LS.write("fp:pagamentos",n); };
  const desmarcarPago = (nome) => { const n={...pagos}; delete n[nome]; setPagos(n); LS.write("fp:pagamentos",n); };
  const infoPago = (nome) => { const v=pagos[nome]; if(!v) return null; return typeof v==="object" ? v : {ts:v,forma:"PIX"}; };
  const get  = c => { const np = c?.pedidosReal ?? c?.pedidos ?? 0; const fat = c?.fatReal!=null ? c.fatReal : np*PRECO; const ip=infoPago(c?.nome); return {np, fat, pago:!!ip, forma:ip?ip.forma:null}; };
  const totFat  = list.reduce((a,c)=>a+get(c).fat,0);
  const totPago = list.filter(c=>get(c).pago).reduce((a,c)=>a+get(c).fat,0);

  const gerarExtratoPDF = () => {
    const peds = (meusPedidos||[]).filter(p=>p.enviado!==false); // só os já fechados em remessa
    const precoP = (p)=> p.valorPalmilha!=null ? p.valorPalmilha : precoPalmilha(p.produto||p.tipo||"", p.antecipado===true);
    const fretesMap = {};
    peds.forEach(p=>{ if(p.remessaId && p.freteValor!=null) fretesMap[p.remessaId]={label:p.freteLabel||"Frete",valor:p.freteValor,data:p.remessaData||""}; });
    const fretesList = Object.values(fretesMap);
    const subPalm = peds.reduce((a,p)=>a+precoP(p),0);
    const subFrete = fretesList.reduce((a,f)=>a+f.valor,0);
    const total = subPalm+subFrete;
    const ant = peds.filter(p=>p.antecipado===true).length, fatd = peds.filter(p=>p.pagarDepois===true).length;
    const pagTxt = ant&&!fatd ? "Antecipado" : fatd&&!ant ? "Faturado" : ant&&fatd ? "Misto" : "—";
    const hoje = new Date().toLocaleDateString("pt-BR");
    const esc=(s)=>String(s==null?"":s);
    const pacRows = peds.map((p,i)=>`<tr><td style="color:#94A3B8;">${i+1}</td><td style="font-weight:600;">${esc(p.paciente||"(sem nome)")}</td><td>${esc(p.produto||(/hinelo/i.test(p.tipo||"")?"Chinelo":"Palmilha"))}</td><td style="text-align:right;font-weight:700;color:#059669;">R$ ${brl(precoP(p))}</td></tr>`).join("");
    const freteRows = fretesList.map(f=>`<tr><td>${esc(f.label)}</td><td>${f.data?esc(f.data.split("-").reverse().join("/")):"—"}</td><td style="text-align:right;font-weight:700;">R$ ${brl(f.valor)}</td></tr>`).join("") || `<tr><td colspan="3" style="color:#94A3B8;">Sem fretes</td></tr>`;
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Extrato — ${esc(clinicaName||"Clínica")}</title>
      <style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0F172A;font-size:13px;line-height:1.6;}
      .wrap{max-width:760px;margin:0 auto;padding:40px 44px;}
      .top{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:18px;border-bottom:3px solid #3B82F6;}
      .marca{font-size:27px;font-weight:800;color:#3B82F6;letter-spacing:-.5px;line-height:1;}.marca span{color:#0F172A;}
      .sub{font-size:10px;color:#64748B;letter-spacing:.12em;margin-top:4px;font-weight:700;}
      .meta{text-align:right;font-size:12px;color:#475569;}
      .faixa{background:linear-gradient(135deg,#3B82F6,#6366F1);color:#fff;border-radius:12px;padding:18px 22px;margin:18px 0 6px;display:flex;justify-content:space-between;align-items:center;}
      .faixa .nm{font-size:18px;font-weight:800;}.faixa .tt{text-align:right;}.faixa .tt small{display:block;font-size:10px;opacity:.85;text-transform:uppercase;letter-spacing:.08em;}.faixa .tt b{font-size:24px;}
      table{width:100%;border-collapse:collapse;margin:8px 0 4px;}th,td{padding:9px 11px;text-align:left;}
      thead th{font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:#64748B;border-bottom:2px solid #E2E8F0;}
      tbody tr:nth-child(even){background:#F8FAFC;}tbody td{border-bottom:1px solid #EEF2F6;}
      .tot td{font-weight:800;border-top:2px solid #CBD5E1;background:#fff!important;}
      .bt{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#3B82F6;margin:22px 0 4px;}
      .pixbox{margin-top:16px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:13px 16px;font-size:12px;color:#1E3A8A;}
      .foot{margin-top:30px;border-top:1px solid #E2E8F0;padding-top:14px;font-size:10px;color:#94A3B8;text-align:center;}
      @media print{.wrap{padding:24px 26px;}button{display:none;}}</style></head><body><div class="wrap">
      <div class="top"><div><div class="marca">Fisio<span>Piede</span></div><div class="sub">HEALTH TECH PLATFORM</div></div>
      <div class="meta">Extrato de pedidos<br>Emitido em ${esc(hoje)}</div></div>
      <div class="faixa"><div><div class="nm">${esc(clinicaName||"Clínica")}</div><div style="font-size:11px;opacity:.9;margin-top:3px;">${peds.length} palmilha(s) · Pagamento: ${pagTxt}</div></div>
        <div class="tt"><small>Total a pagar</small><b>R$ ${brl(total)}</b></div></div>
      <div class="bt">Pacientes &amp; Modelos</div>
      <table><thead><tr><th style="width:28px;">#</th><th>Paciente</th><th>Modelo</th><th style="text-align:right;">Valor</th></tr></thead><tbody>${pacRows}
        <tr class="tot"><td></td><td>Subtotal palmilhas</td><td></td><td style="text-align:right;">R$ ${brl(subPalm)}</td></tr></tbody></table>
      <div class="bt">Fretes por remessa</div>
      <table><thead><tr><th>Frete</th><th>Data</th><th style="text-align:right;">Valor</th></tr></thead><tbody>${freteRows}
        <tr class="tot"><td>Subtotal fretes</td><td></td><td style="text-align:right;">R$ ${brl(subFrete)}</td></tr></tbody></table>
      <table><tbody><tr class="tot" style="font-size:15px;"><td>TOTAL A PAGAR</td><td></td><td style="text-align:right;color:#059669;">R$ ${brl(total)}</td></tr></tbody></table>
      <div class="pixbox">💳 <b>Pagamento via PIX</b> — chave: <b>${PIX_FP}</b><br>Após o pagamento, envie o comprovante para confirmarmos o recebimento.</div>
      <div class="foot">FisioPiede Health Tech Platform • Extrato financeiro da clínica</div>
      </div><script>window.onload=function(){setTimeout(function(){window.print();},350);};<\/script></body></html>`;
    const w = window.open("","_blank"); if(!w){ alert("Permita pop-ups para gerar o relatório."); return; }
    w.document.open(); w.document.write(html); w.document.close();
  };

  const [pagandoCartao,setPagandoCartao] = useState(false);
  const TAXA_CARTAO = 0.05; // 5% de acréscimo no cartão
  const totalCartao = fatClinica * (1 + TAXA_CARTAO);
  const pagarFechamentoCartao = async () => {
    if(fatClinica<=0){ alert("Não há valor em aberto para pagar."); return; }
    setPagandoCartao(true);
    try {
      const r = await fetch("/api/stripe", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          valorCentavos: Math.round(totalCartao*100),
          descricao: `Fechamento FisioPiede — ${clinicaName||"Clínica"}`,
          clinicaId: clinicaObj?.id||"", email: clinicaObj?.email||"",
          origem: (typeof window!=="undefined"&&window.location?window.location.origin:"")
        }),
      });
      const d = await r.json();
      if(d.url){ window.location.href = d.url; }
      else { alert(d.error?.message || "Não foi possível abrir o pagamento. O pagamento por cartão requer o sistema publicado."); setPagandoCartao(false); }
    } catch(e){ alert("Não foi possível abrir o pagamento agora. Tente novamente."); setPagandoCartao(false); }
  };
  return (
    <div style={{padding:20}}>
      <SH title="Gestão Financeira" sub={`Maio 2025 · R$ ${brl(PRECO)} por pedido`} right={!isAdmin&&meusPedidos?<Btn v="primary" sz="sm" onClick={gerarExtratoPDF}>📄 Relatório / Extrato PDF</Btn>:null}/>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:18}}>
        {[{l:"Faturamento",v:totFat,c:C.accent},{l:"Recebido",v:totPago,c:C.green},{l:"Pendente",v:totFat-totPago,c:C.amber},{l:"Pedidos",v:list.reduce((a,c)=>a+get(c).np,0),c:C.purple}].map((m,i)=>(
          <Card key={i} p={16}><div style={{fontSize:11,color:C.muted,marginBottom:7}}>{m.l}</div><div style={{fontSize:20,fontWeight:900,color:m.c}}>{i<3?"R$ ":""}<ANum value={m.v}/></div></Card>
        ))}
      </div>
      {!isAdmin&&meusPedidos&&fatClinica>0&&(
        <Card hover={false} p={0} style={{overflow:"hidden",marginBottom:18,border:`1px solid ${C.accent}30`}}>
          <div style={{padding:"13px 16px",borderBottom:`1px solid ${C.border}`,background:`${C.accent}0A`,fontWeight:800}}>💳 Pagar fechamento</div>
          <div style={{padding:16,display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <div style={{border:`1px solid ${C.border}`,borderRadius:10,padding:14}}>
              <div style={{fontSize:11,color:C.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em"}}>PIX</div>
              <div style={{fontSize:22,fontWeight:900,color:C.green,margin:"4px 0"}}>R$ {brl(fatClinica)}</div>
              <div style={{fontSize:11,color:C.muted,marginBottom:10}}>Sem taxa · valor normal</div>
              <Btn v="outline" full sz="sm" onClick={gerarExtratoPDF}>Ver chave PIX / extrato</Btn>
            </div>
            <div style={{border:`1px solid ${C.accent}40`,borderRadius:10,padding:14,background:`${C.accent}06`}}>
              <div style={{fontSize:11,color:C.accent,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em"}}>Cartão de crédito</div>
              <div style={{fontSize:22,fontWeight:900,color:C.accent,margin:"4px 0"}}>R$ {brl(totalCartao)}</div>
              <div style={{fontSize:11,color:C.muted,marginBottom:10}}>Inclui 5% de taxa do cartão</div>
              <Btn v="primary" full sz="sm" disabled={pagandoCartao} onClick={pagarFechamentoCartao}>{pagandoCartao?"Abrindo pagamento...":"Pagar com cartão"}</Btn>
            </div>
          </div>
          <div style={{padding:"0 16px 16px"}}>
            <Btn v="ghost" sz="sm" full onClick={()=>gerarReciboPDF({clinica:clinicaName, descricao:`Fechamento de pedidos (${(meusPedidos||[]).filter(p=>p.enviado!==false).length} palmilha(s))`, valor:fatClinica, forma:"PIX"})}>🧾 Gerar recibo do fechamento</Btn>
          </div>
        </Card>
      )}
      <Card hover={false} p={0} style={{overflow:"hidden"}}>
        <div style={{padding:"13px 16px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}><div style={{fontWeight:800}}>{isAdmin?"Cobranças por Clínica":"Meus pedidos"}</div></div>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
          <thead><tr style={{borderBottom:`1px solid ${C.border}`}}>{["Clínica","Pedidos","Valor","Lucro","Status","Ações"].map(h=><th key={h} style={{padding:"10px 16px",textAlign:"left",color:C.muted,fontWeight:700,fontSize:9,letterSpacing:".06em",textTransform:"uppercase"}}>{h}</th>)}</tr></thead>
          <tbody>
            {list.map((c,i)=>{
              const d=get(c), lucro=d.fat-d.np*80;
              return (
                <tr key={i} style={{borderBottom:`1px solid ${C.border}`,transition:"background .12s"}} onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,.02)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <td style={{padding:"12px 16px",fontWeight:700}}>{c.nome}</td>
                  <td style={{padding:"12px 16px",fontWeight:800}}>{d.np}</td>
                  <td style={{padding:"12px 16px",color:C.green,fontWeight:800}}>R$ {brl(d.fat)}</td>
                  <td style={{padding:"12px 16px",fontWeight:800,color:lucro>0?C.green:C.red}}>R$ {brl(lucro)}</td>
                  <td style={{padding:"12px 16px"}}><div style={{display:"flex",flexDirection:"column",gap:2}}><Badge label={d.pago?"Pago":"Pendente"} color={d.pago?C.green:C.amber}/>{d.pago&&d.forma&&<span style={{fontSize:9.5,color:C.muted,fontWeight:600}}>via {d.forma}</span>}</div></td>
                  <td style={{padding:"12px 16px"}}><div style={{display:"flex",gap:5,flexWrap:"wrap"}}>{!d.pago?<><Btn v="primary" sz="sm" onClick={()=>setPagar({nome:c.nome,fat:d.fat,np:d.np})}>💳 Cobrar</Btn><Btn v="ghost" sz="sm" onClick={()=>setBaixa({nome:c.nome,fat:d.fat,np:d.np})}>✅ Dar baixa</Btn></>:<><span style={{fontSize:11,color:C.green,fontWeight:700}}>✓ Pago</span><button onClick={()=>{ if(confirm(`Estornar a baixa de ${c.nome}? O status volta para Pendente.`)) desmarcarPago(c.nome); }} style={{background:"none",color:C.muted,fontSize:10,fontWeight:700,padding:0,textDecoration:"underline"}}>estornar</button></>}</div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      {pagar&&<PagamentoModal clinica={pagar.nome} valor={pagar.fat} nPedidos={pagar.np} onClose={()=>setPagar(null)} onPago={(forma)=>marcarPago(pagar.nome,forma)}/>}
      {baixa&&<BaixaManualModal clinica={baixa.nome} valor={baixa.fat} nPedidos={baixa.np} onClose={()=>setBaixa(null)} onConfirmar={(forma)=>{ marcarPago(baixa.nome,forma); setBaixa(null); }} onRecibo={(forma)=>gerarReciboPDF({clinica:baixa.nome, descricao:`Fechamento de pedidos (${baixa.np} palmilha(s))`, valor:baixa.fat, forma})}/>}
    </div>
  );
}

// ─── FECHAMENTO ────────────────────────────────────────────────────────────────
function FechamentoPage({clinicas,pedidos}) {
  const hojeISO = new Date().toISOString().split("T")[0];
  const ini1 = hojeISO.slice(0,8)+"01";
  const [de,setDe]       = useState(ini1);
  const [ate,setAte]     = useState(hojeISO);
  const [clinicaSel,setClinicaSel] = useState("Todas");
  const [gerado,setGerado] = useState(false);
  const [exp,setExp]     = useState(null);
  const periodoLabel = `${de.split("-").reverse().join("/")} a ${ate.split("-").reverse().join("/")}`;
  const noPeriodo = (p) => { const d=(p.remessaData||p.data||"").slice(0,10); return (!de||d>=de)&&(!ate||d<=ate); };
  const precoProd = (p) => p.valorPalmilha!=null ? p.valorPalmilha : precoPalmilha(p.produto||p.tipo||"", p.antecipado===true);
  const clinicasFiltradas = clinicaSel==="Todas" ? clinicas : clinicas.filter(c=>c.nome===clinicaSel);
  const rows = clinicasFiltradas.map(c=>{
    const peds = pedidos ? pedidos.filter(p=>p.clinicaId===c.id && noPeriodo(p)) : [];
    const np = peds.length;
    const fat = peds.reduce((a,p)=>a+precoProd(p),0);
    const remessas = {};
    peds.forEach(p=>{ if(p.remessaId && p.freteValor!=null) remessas[p.remessaId]={label:p.freteLabel||"Frete",valor:p.freteValor,data:p.remessaData||""}; });
    const fretesList = Object.entries(remessas).map(([id,r])=>({id,...r}));
    const frete = fretesList.reduce((a,r)=>a+r.valor,0);
    return {...c,np,fat,peds,fretesList,custo:np*80,frete,desp:np*5,lucro:fat-np*100,cobranca:fat,totalCobrar:fat+frete};
  });
  const tot  = {np:rows.reduce((a,r)=>a+r.np,0),fat:rows.reduce((a,r)=>a+r.fat,0),lucro:rows.reduce((a,r)=>a+r.lucro,0),cob:rows.reduce((a,r)=>a+r.cobranca,0)};
  const totGeralCobrar = rows.reduce((a,r)=>a+r.totalCobrar,0);
  const totFrete = rows.reduce((a,r)=>a+r.frete,0);

  const enviarCobranca = (r) => {
    const tel = String(r.tel||"").replace(/\D/g,"");
    const linhasPac = (r.peds||[]).map(p=>`• ${p.paciente||"(sem nome)"} — ${p.produto||p.tipoProduto||(/hinelo/i.test(p.tipo||"")?"Chinelo":"Palmilha")} (R$ ${brl(precoProd(p))})`).join("\n");
    const linhasFrete = (r.fretesList||[]).map(fr=>`• ${fr.label}${fr.data?` (${fr.data})`:""} — R$ ${brl(fr.valor)}`).join("\n") || "• Sem fretes no período";
    const msg = `Olá ${r.resp||r.nome}! 👋\n\n*Fechamento FisioPiede — ${periodoLabel}*\n\n🦶 *Palmilhas (${r.np}):*\n${linhasPac}\n\n📦 *Fretes:*\n${linhasFrete}\n\n💰 *Total a pagar: R$ ${brl(r.totalCobrar)}*\n\n*Pague via PIX:*\n🔑 ${PIX_FP}\n\nApós o pagamento, envie o comprovante por aqui. Obrigado! 🦶✨`;
    if(tel) window.open(`https://wa.me/55${tel}?text=${encodeURIComponent(msg)}`,"_blank");
    else { navigator.clipboard?.writeText(msg); alert("Esta clínica não tem telefone cadastrado. A mensagem foi copiada para você colar no WhatsApp."); }
  };

  const abrirRelatorio = (titulo, corpoHtml) => {
    const w = window.open("","_blank"); if(!w){ alert("Permita pop-ups para gerar o relatório."); return; }
    const esc=(s)=>String(s==null?"":s);
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
      <style>*{box-sizing:border-box;margin:0;padding:0;}
      body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0F172A;padding:0;font-size:13px;line-height:1.6;background:#fff;}
      .wrap{max-width:760px;margin:0 auto;padding:40px 44px;}
      .top{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:18px;margin-bottom:8px;border-bottom:3px solid #3B82F6;}
      .marca{font-size:27px;font-weight:800;color:#3B82F6;letter-spacing:-.5px;line-height:1;}
      .marca span{color:#0F172A;}
      .sub{font-size:10px;color:#64748B;letter-spacing:.12em;margin-top:4px;font-weight:700;}
      .meta{text-align:right;font-size:12px;color:#475569;}
      .faixa{background:linear-gradient(135deg,#3B82F6,#6366F1);color:#fff;border-radius:12px;padding:18px 22px;margin:18px 0 6px;display:flex;justify-content:space-between;align-items:center;}
      .faixa .nm{font-size:18px;font-weight:800;}
      .faixa .tt{text-align:right;}
      .faixa .tt small{display:block;font-size:10px;opacity:.85;text-transform:uppercase;letter-spacing:.08em;}
      .faixa .tt b{font-size:24px;}
      h1{font-size:16px;margin-bottom:3px;}
      table{width:100%;border-collapse:collapse;margin:8px 0 4px;}
      th,td{padding:9px 11px;text-align:left;}
      thead th{font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:#64748B;border-bottom:2px solid #E2E8F0;}
      tbody tr:nth-child(even){background:#F8FAFC;}
      tbody td{border-bottom:1px solid #EEF2F6;}
      .tot td{font-weight:800;border-top:2px solid #CBD5E1;background:#fff!important;}
      .bt{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#3B82F6;margin:22px 0 4px;}
      .foot{margin-top:30px;border-top:1px solid #E2E8F0;padding-top:14px;font-size:10px;color:#94A3B8;text-align:center;}
      .pixbox{margin-top:16px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:13px 16px;font-size:12px;color:#1E3A8A;}
      @media print{.wrap{padding:24px 26px;}button{display:none;}}</style></head><body><div class="wrap">
      <div class="top"><div><div class="marca">Fisio<span>Piede</span></div><div class="sub">HEALTH TECH PLATFORM</div></div>
      <div class="meta">Período: ${esc(periodoLabel)}<br>Emitido em ${new Date().toLocaleDateString("pt-BR")}</div></div>
      ${corpoHtml}
      <div class="foot">FisioPiede Health Tech Platform • Documento de fechamento financeiro • Sistema de Palmilhas Posturais 3D</div>
      </div><script>window.onload=function(){setTimeout(function(){window.print();},350);};<\/script></body></html>`;
    w.document.open(); w.document.write(html); w.document.close();
  };

  const relatorioClinica = (r) => {
    const ant = (r.peds||[]).filter(p=>p.antecipado===true).length;
    const fat = (r.peds||[]).filter(p=>p.pagarDepois===true).length;
    const pagTxt = ant&&!fat ? "Antecipado" : fat&&!ant ? "Faturado (pagar no fechamento)" : ant&&fat ? "Misto (antecipado + faturado)" : "—";
    const pacRows = (r.peds||[]).map((p,idx)=>`<tr><td style="color:#94A3B8;">${idx+1}</td><td style="font-weight:600;">${p.paciente||"(sem nome)"}</td><td>${p.produto||p.tipoProduto||(/hinelo/i.test(p.tipo||"")?"Chinelo":"Palmilha")}</td><td style="text-align:right;font-weight:700;color:#059669;">R$ ${brl(precoProd(p))}</td></tr>`).join("");
    const freteRows = (r.fretesList||[]).map(fr=>`<tr><td>${fr.label}</td><td>${fr.data?fr.data.split("-").reverse().join("/"):"—"}</td><td style="text-align:right;font-weight:700;">R$ ${brl(fr.valor)}</td></tr>`).join("") || `<tr><td colspan="3" style="color:#94A3B8;">Sem fretes no período</td></tr>`;
    abrirRelatorio(`Fechamento — ${r.nome}`, `
      <div class="faixa"><div><div class="nm">${r.nome}</div><div style="font-size:11px;opacity:.9;margin-top:3px;">${r.np} palmilha(s) · Pagamento: ${pagTxt}</div></div>
        <div class="tt"><small>Total a pagar</small><b>R$ ${brl(r.totalCobrar)}</b></div></div>
      <div class="bt">Pacientes &amp; Modelos</div>
      <table><thead><tr><th style="width:28px;">#</th><th>Paciente</th><th>Modelo</th><th style="text-align:right;">Valor</th></tr></thead><tbody>${pacRows}
        <tr class="tot"><td></td><td>Subtotal palmilhas</td><td></td><td style="text-align:right;">R$ ${brl(r.fat)}</td></tr></tbody></table>
      <div class="bt">Fretes por remessa</div>
      <table><thead><tr><th>Frete</th><th>Data</th><th style="text-align:right;">Valor</th></tr></thead><tbody>${freteRows}
        <tr class="tot"><td>Subtotal fretes</td><td></td><td style="text-align:right;">R$ ${brl(r.frete)}</td></tr></tbody></table>
      <table><tbody><tr class="tot" style="font-size:15px;"><td>TOTAL A PAGAR</td><td></td><td style="text-align:right;color:#059669;">R$ ${brl(r.totalCobrar)}</td></tr></tbody></table>
      <div class="pixbox">💳 <b>Pagamento via PIX</b> — chave: <b>${PIX_FP}</b><br>Após o pagamento, envie o comprovante para confirmarmos o recebimento.</div>`);
  };

  const relatorioTotal = () => {
    const linhas = rows.map(r=>`<tr><td>${r.nome}</td><td>${r.np}</td><td>R$ ${brl(r.fat)}</td><td>R$ ${brl(r.frete)}</td><td>R$ ${brl(r.totalCobrar)}</td></tr>`).join("");
    abrirRelatorio(`Fechamento Total — ${periodoLabel}`, `
      <h1>Fechamento Consolidado</h1>
      <table><thead><tr><th>Clínica</th><th>Pedidos</th><th>Palmilhas</th><th>Fretes</th><th>Total</th></tr></thead><tbody>${linhas}
        <tr class="tot"><td>TOTAL GERAL</td><td>${tot.np}</td><td>R$ ${brl(tot.fat)}</td><td>R$ ${brl(totFrete)}</td><td style="color:#059669;">R$ ${brl(totGeralCobrar)}</td></tr></tbody></table>`);
  };
  return (
    <div style={{padding:20}}>
      <SH title="Fechamento Mensal" sub="Relatório financeiro consolidado" right={<div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
        <select value={clinicaSel} onChange={e=>{setClinicaSel(e.target.value);setGerado(false);}} style={{width:150}}><option>Todas</option>{clinicas.map(c=><option key={c.id}>{c.nome}</option>)}</select>
        <input type="date" value={de} onChange={e=>{setDe(e.target.value);setGerado(false);}} style={{width:140}}/>
        <input type="date" value={ate} onChange={e=>{setAte(e.target.value);setGerado(false);}} style={{width:140}}/>
        <Btn v="gold" onClick={()=>setGerado(true)}>⚡ Gerar Fechamento</Btn>
      </div>}/>
      {!gerado&&<div style={{textAlign:"center",padding:60,color:C.muted}}><div style={{fontSize:48,marginBottom:14}}>📋</div><div style={{fontSize:15,fontWeight:700,marginBottom:6}}>Escolha a clínica e o período, depois clique em Gerar Fechamento</div></div>}
      {gerado&&(
        <div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:18}}>
            {[{l:"Total Pedidos",v:tot.np,c:C.purple},{l:"Faturamento Bruto",v:tot.fat,c:C.accent},{l:"Lucro Líquido",v:tot.lucro,c:C.green},{l:"Cobrança FisioPiede",v:tot.cob,c:C.gold}].map((m,i)=>(
              <Card key={i} p={16} style={{border:`1px solid ${m.c}22`}}><div style={{fontSize:11,color:C.muted,marginBottom:7}}>{m.l}</div><div style={{fontSize:20,fontWeight:900,color:m.c}}>{i>0?"R$ ":""}<ANum value={m.v}/></div></Card>
            ))}
          </div>
          <Card p={14} style={{marginBottom:16,background:`${C.gold}06`,border:`1px solid ${C.gold}20`}}>
            <div style={{fontSize:10,color:C.gold,fontWeight:700,textTransform:"uppercase",marginBottom:7}}>⚡ Regra de Cobrança</div>
            <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",fontSize:13}}>
              <span style={{color:C.muted}}>Nº Pedidos</span><span style={{color:C.sub}}>×</span>
              <span style={{color:C.gold,fontWeight:800}}>R$ {brl(PRECO)}</span><span style={{color:C.sub}}>=</span>
              <span style={{color:C.green,fontWeight:900,fontSize:16}}>R$ {brl(tot.cob)}</span>
              <span style={{color:C.muted,fontSize:11}}>total a cobrar · {periodoLabel}</span>
            </div>
          </Card>
          <Card hover={false} p={0} style={{overflow:"hidden"}}>
            <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}><div style={{fontWeight:800}}>Fechamento Detalhado — {periodoLabel}</div><div style={{display:"flex",gap:7}}><Btn v="gold" sz="sm" onClick={relatorioTotal}>📄 Relatório Total</Btn></div></div>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead><tr style={{borderBottom:`1px solid ${C.border}`}}>{["Clínica","Pedidos","Fat. Bruto","Custo","Frete","Outras","Lucro","Cobrança FP"].map(h=><th key={h} style={{padding:"9px 12px",textAlign:"left",color:C.muted,fontWeight:700,fontSize:9,letterSpacing:".07em",textTransform:"uppercase"}}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r,i)=>(
                  <React.Fragment key={i}>
                  <tr style={{borderBottom:`1px solid ${C.border}`,transition:"background .12s",cursor:r.peds&&r.peds.length?"pointer":"default"}} onClick={()=>{ if(r.peds&&r.peds.length) setExp(exp===r.id?null:r.id); }} onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,.018)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <td style={{padding:"11px 12px",fontWeight:700}}>{r.peds&&r.peds.length?<span style={{color:C.accent,marginRight:6}}>{exp===r.id?"▾":"▸"}</span>:null}{r.nome}</td>
                    <td style={{padding:"11px 12px",fontWeight:700}}>{r.np}</td>
                    <td style={{padding:"11px 12px",color:C.green,fontWeight:700}}>R$ {brl(r.fat)}</td>
                    <td style={{padding:"11px 12px",color:C.muted}}>R$ {brl(r.custo)}</td>
                    <td style={{padding:"11px 12px",color:C.muted}}>R$ {brl(r.frete)}</td>
                    <td style={{padding:"11px 12px",color:C.muted}}>R$ {brl(r.desp)}</td>
                    <td style={{padding:"11px 12px",fontWeight:800,color:r.lucro>0?C.green:C.red}}>R$ {brl(r.lucro)}</td>
                    <td style={{padding:"11px 12px",fontWeight:900,color:C.gold}}>R$ {brl(r.cobranca)}</td>
                  </tr>
                  {exp===r.id&&r.peds&&r.peds.length>0&&(
                    <tr style={{background:`${C.accent}05`}}>
                      <td colSpan={8} style={{padding:"4px 16px 14px"}}>
                        <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:16}}>
                          <div>
                            <div style={{fontSize:9,color:C.accent,fontWeight:800,textTransform:"uppercase",letterSpacing:".07em",margin:"10px 0 7px"}}>👤 Pacientes & Palmilhas</div>
                            {r.peds.map((p,j)=>(
                              <div key={j} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${C.border}`,fontSize:12}}>
                                <span style={{color:C.text,fontWeight:600}}>{p.paciente||"(sem nome)"}</span>
                                <span style={{color:C.muted}}>{p.produto||p.tipoProduto||(/hinelo/i.test(p.tipo||"")?"Chinelo":"Palmilha")} · <span style={{color:C.green,fontWeight:700}}>R$ {brl(precoProd(p))}</span></span>
                              </div>
                            ))}
                          </div>
                          <div>
                            <div style={{fontSize:9,color:C.green,fontWeight:800,textTransform:"uppercase",letterSpacing:".07em",margin:"10px 0 7px"}}>📦 Fretes por remessa</div>
                            {r.fretesList&&r.fretesList.length>0 ? r.fretesList.map((fr,k)=>(
                              <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${C.border}`,fontSize:12}}>
                                <span style={{color:C.sub}}>{fr.label}{fr.data?` · ${fr.data}`:""}</span>
                                <span style={{color:C.green,fontWeight:700}}>R$ {brl(fr.valor)}</span>
                              </div>
                            )) : <div style={{fontSize:11,color:C.muted,padding:"6px 0"}}>Nenhuma remessa fechada ainda</div>}
                            {r.fretesList&&r.fretesList.length>0&&(
                              <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0 0",fontSize:12,fontWeight:800}}>
                                <span style={{color:C.text}}>Total fretes</span><span style={{color:C.green}}>R$ {brl(r.frete)}</span>
                              </div>
                            )}
                          </div>
                        </div>
                        <div style={{display:"flex",gap:8,marginTop:14,flexWrap:"wrap"}}>
                          <Btn v="primary" sz="sm" onClick={(e)=>{e.stopPropagation&&e.stopPropagation();enviarCobranca(r);}}>📤 Enviar cobrança (WhatsApp + PIX)</Btn>
                          <Btn v="outline" sz="sm" onClick={(e)=>{e.stopPropagation&&e.stopPropagation();relatorioClinica(r);}}>📄 Relatório desta clínica</Btn>
                          <div style={{marginLeft:"auto",alignSelf:"center",fontSize:13}}>Total a cobrar: <b style={{color:C.green}}>R$ {brl(r.totalCobrar)}</b></div>
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                ))}
                <tr style={{borderTop:`2px solid ${C.border}`,background:C.bgGlass}}>
                  <td style={{padding:"11px 12px",fontWeight:900}}>TOTAL</td>
                  <td style={{padding:"11px 12px",fontWeight:900}}>{tot.np}</td>
                  <td style={{padding:"11px 12px",color:C.green,fontWeight:900}}>R$ {brl(tot.fat)}</td>
                  <td colSpan={3}/>
                  <td style={{padding:"11px 12px",color:C.green,fontWeight:900}}>R$ {brl(tot.lucro)}</td>
                  <td style={{padding:"11px 12px",color:C.gold,fontWeight:900,fontSize:14}}>R$ {brl(tot.cob)}</td>
                </tr>
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}

// ─── PRODUÇÃO ──────────────────────────────────────────────────────────────────
function ProducaoPage({pedidos,setPedidos}) {
  const cols = ["Analisando","Em Produção","Impressão 3D","Acabamento","Enviado","Finalizado"];
  const [drag,setDrag] = useState(null);
  const move = (id,st) => { const t=nowTs(); setPedidos(p=>p.map(x=>{
    if(x.id!==id) return x;
    // 🔔 Avisa clínica e paciente quando o pedido avança no kanban
    try {
      const sc3 = STATUS_CFG[st]||{icon:"📦"};
      if(x.clinicaId) pushNotif("clinica:"+x.clinicaId, sc3.icon||"📦", `Pedido ${x.id} — ${st}`, `${x.paciente}: agora "${st}"`, "pedidos");
      if(x.pacienteId) pushNotif("paciente:"+x.pacienteId, "🦶", `Sua palmilha: ${st}`, `Seu pedido ${x.id} está em "${st}".`, "dashboard");
    } catch(e){}
    return {...x,status:st,updatedAt:t,log:[...x.log,`${t} — ${st}`]};
  })); };
  return (
    <div style={{padding:20}}>
      <SH title="Painel de Produção" sub={`Kanban em tempo real · ${pedidos.filter(p=>!["Recebido","Finalizado"].includes(p.status)).length} pedidos em andamento`}/>
      <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:10,overflowX:"auto",minWidth:900}}>
        {cols.map(col=>{
          const sc=STATUS_CFG[col]||{color:C.sub};
          const items=pedidos.filter(p=>p.status===col);
          return (
            <div key={col} onDragOver={e=>e.preventDefault()} onDrop={()=>drag&&move(drag,col)}>
              <div style={{padding:"7px 10px",borderRadius:8,marginBottom:8,background:`${sc.color}10`,border:`1px solid ${sc.color}25`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:11,fontWeight:800,color:sc.color}}>{sc.icon} {col}</span>
                <span style={{width:18,height:18,borderRadius:"50%",background:sc.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:900,color:"#fff"}}>{items.length}</span>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:7}}>
                {items.map(p=>{
                  const sc2=STATUS_CFG[p.status]||{color:C.sub};
                  return (
                    <div key={p.id} draggable onDragStart={()=>setDrag(p.id)} onDragEnd={()=>setDrag(null)}>
                      <Card style={{padding:12,cursor:"grab",userSelect:"none"}}>
                        <div style={{fontFamily:"'Space Mono',monospace",fontSize:9,color:sc2.color,marginBottom:4}}>{p.id}</div>
                        <div style={{fontWeight:700,fontSize:12,marginBottom:2}}>{p.paciente}</div>
                        <div style={{fontSize:10,color:C.muted,marginBottom:7}}>{p.clinica}</div>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7}}><Badge label={p.tipoPalmilha||p.tipo} color={C.accent}/><span style={{fontSize:9,color:C.muted}}>{p.updatedAt}</span></div>
                        <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
                          {STATUS_FLOW.filter(s=>s!==col&&s!=="Recebido").slice(0,2).map(s=>{
                            const sc3=STATUS_CFG[s]||{color:C.muted};
                            return <button key={s} onClick={()=>move(p.id,s)} style={{fontSize:8,padding:"2px 5px",borderRadius:4,background:`${sc3.color}12`,color:sc3.color,border:`1px solid ${sc3.color}22`,cursor:"pointer"}}>→{s.split(" ")[0]}</button>;
                          })}
                        </div>
                      </Card>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── PRONTUÁRIO ────────────────────────────────────────────────────────────────
function ProntuarioModal({paciente,onClose,clinicaId,planoIA}) {
  const [aba,setAba]       = useState("timeline");
  const dados              = PRONT[paciente.id]||{avaliacoes:[],evolucoes:[],pedidos:[],exames:[],prescricoes:[]};
  const [evos,setEvos]     = useState(dados.evolucoes);
  const [novaEvo,setNovaEvo] = useState({descricao:"",prof:"Dra. Silva"});
  const [showNE,setShowNE] = useState(false);
  const [sign,setSign]     = useState(null);
  const ABAS = [{id:"timeline",icon:"🕒",label:"Timeline 360°"},{id:"resumo",icon:"⬡",label:"Resumo"},{id:"avaliacoes",icon:"🩺",label:"Avaliações"},{id:"evolucao",icon:"📋",label:"Evolução"},{id:"dor",icon:"📈",label:"Evolução da Dor"},{id:"pedidos",icon:"📦",label:"Pedidos"},{id:"exames",icon:"🔬",label:"Exames"},{id:"chat",icon:"💬",label:"Chat"},{id:"prescricoes",icon:"💊",label:"Prescrições"}];
  const idade = paciente.nascimento ? Math.floor((new Date()-new Date(paciente.nascimento))/31557600000) : "—";
  // IMC automático (peso kg / altura m²)
  const imcCalc = (() => {
    const p = parseFloat(String(paciente.peso||"").replace(",","."));
    let a = parseFloat(String(paciente.altura||"").replace(",","."));
    if(!p || !a) return null;
    if(a > 3) a = a/100; // altura em cm → m
    const v = p/(a*a);
    if(!isFinite(v) || v<=0) return null;
    let cls = "Peso normal", cor = C.green;
    if(v<18.5){ cls="Abaixo do peso"; cor=C.amber; }
    else if(v<25){ cls="Peso normal"; cor=C.green; }
    else if(v<30){ cls="Sobrepeso"; cor=C.amber; }
    else { cls="Obesidade"; cor=C.red; }
    return { valor:v.toFixed(1), cls, cor };
  })();
  const salvarEvo = () => {
    if(!novaEvo.descricao.trim()) return;
    setEvos(p=>[{id:Date.now(),data:new Date().toLocaleDateString("pt-BR"),prof:novaEvo.prof,texto:novaEvo.descricao,assinada:false},...p]);
    setNovaEvo({descricao:"",prof:"Dra. Silva"});
    setShowNE(false);
  };
  // ── Prontuário Inteligente: resumo clínico gerado por IA ──
  const [resumoIA, setResumoIA] = useState(null);
  const [loadingResumo, setLoadingResumo] = useState(false);
  const [erroResumo, setErroResumo] = useState("");
  const baros = paciente.baropodometrias || [];
  const dorReg = (typeof LS!=="undefined" && LS.read) ? (LS.read("fp:dor:"+paciente.id)||[]) : [];
  // ── Timeline 360°: agrega todos os eventos do paciente numa linha do tempo ──
  const parseData = (s) => {
    if(!s) return 0;
    if(typeof s==="number") return s;
    const str = String(s).trim();
    if(/^\d{2}\/\d{2}\/\d{4}/.test(str)){ const p=str.split(" ")[0].split("/"); return new Date(`${p[2]}-${p[1]}-${p[0]}`).getTime()||0; }
    const t = new Date(str).getTime(); return isNaN(t)?0:t;
  };
  const fmtData = (s) => { const t=parseData(s); return t? new Date(t).toLocaleDateString("pt-BR") : (s||"—"); };
  const eventosTimeline = [
    ...(dados.avaliacoes||[]).map(a=>({tipo:"Avaliação",icon:"🩺",cor:C.accent,data:a.data,desc:a.tipo||a.queixa||a.texto||"Avaliação clínica registrada"})),
    ...(evos||[]).map(e=>({tipo:"Evolução",icon:"📋",cor:C.purple,data:e.data,desc:e.texto,extra:e.prof})),
    ...(dados.pedidos||[]).map(p=>({tipo:"Pedido de palmilha",icon:"📦",cor:C.green,data:p.data,desc:`${p.tipo||"Palmilha"}${p.status?" — "+p.status:""}`})),
    ...baros.map(b=>({tipo:"Baropodometria",icon:"🦶",cor:C.soft,data:b.data,desc:(typeof b.result==="string"?b.result.slice(0,140):"Análise baropodométrica realizada")})),
    ...dorReg.map(d=>({tipo:"Evolução da dor",icon:"📈",cor:C.amber,data:d.data,desc:`Nível de dor: ${d.nivel??d.valor??d.intensidade??"—"}/10${d.local?` — ${d.local}`:""}`})),
    ...(dados.exames||[]).map(x=>({tipo:"Exame",icon:"🔬",cor:C.gold,data:x.data,desc:x.nome||x.tipo||"Exame anexado"})),
    ...(dados.prescricoes||[]).map(pr=>({tipo:"Prescrição",icon:"💊",cor:C.pink,data:pr.data,desc:pr.texto||pr.nome||"Prescrição registrada"})),
  ].filter(e=>e.desc).sort((a,b)=>parseData(b.data)-parseData(a.data));
  const gerarResumoIA = async () => {
    const permIA = podeUsarIA(clinicaId, planoIA); // resumo da timeline consome 1 análise
    if(!permIA.ok){ setErroResumo(permIA.msg); return; }
    setLoadingResumo(true); setErroResumo(""); setResumoIA(null);
    const idadeP = paciente.nascimento ? Math.floor((new Date()-new Date(paciente.nascimento))/31557600000) : "não informada";
    const ctx = {
      paciente: `${paciente.nome} ${paciente.sobrenome||""}`.trim(),
      idade: idadeP, sexo: paciente.sexo, peso: paciente.peso, altura: paciente.altura,
      numeracao: paciente.numeracao, atividade: paciente.atividade,
      patologia: paciente.patologia || "não informada",
      baropodometrias: baros.map(b=>({data:b.data, achados:b.result})),
      evolucao_dor: dorReg,
      evolucoes_clinicas: evos.map(e=>({data:e.data, texto:e.texto})),
    };
    try {
      const res = await fetch("/api/ia", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          model:"claude-opus-4-7", max_tokens:1100,
          messages:[{role:"user",content:[{type:"text",text:`Você é um fisioterapeuta especialista em biomecânica da FisioPiede. Com base nos dados do paciente abaixo, gere um resumo clínico profissional. Dados: ${JSON.stringify(ctx)}. Responda SOMENTE um JSON válido (sem markdown): {"resumo_clinico":"parágrafo objetivo do quadro atual","achados":"principais achados biomecânicos","plano_terapeutico":"conduta e elementos de palmilha sugeridos","exercicios":["ex1","ex2","ex3"],"retorno":"sugestão de prazo de reavaliação"}`}]}],
        }),
      });
      const data = await res.json();
      if(!res.ok) throw new Error((data&&data.error&&data.error.message)||("Erro "+res.status));
      let txt = (data.content||[]).map(b=>b.text||"").join("").replace(/```json|```/g,"").trim();
      const m = txt.match(/\{[\s\S]*\}/);
      setResumoIA(JSON.parse(m?m[0]:txt));
    } catch(e) {
      setErroResumo("Não foi possível gerar o resumo agora ("+((e&&e.message)||"erro")+"). A IA requer o sistema publicado e tenta novamente em instantes.");
    }
    setLoadingResumo(false);
  };
  const gerarLaudoResumoPDF = () => {
    if (!resumoIA) return;
    const esc = (s) => String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const hoje = new Date().toLocaleDateString("pt-BR");
    const idadeP = paciente.nascimento ? Math.floor((new Date()-new Date(paciente.nascimento))/31557600000)+" anos" : "—";
    const bloco = (t,v,c) => v ? `<div class="bt" style="color:${c};border-color:${c};">${esc(t)}</div><div class="bx">${esc(v)}</div>` : "";
    const exs = Array.isArray(resumoIA.exercicios)&&resumoIA.exercicios.length ? `<div class="bt" style="color:#F59E0B;border-color:#F59E0B;">Exercícios recomendados</div><ol class="exs">${resumoIA.exercicios.map(e=>`<li>${esc(e)}</li>`).join("")}</ol>` : "";
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Laudo Clínico — ${esc(paciente.nome)} ${esc(paciente.sobrenome||"")}</title>
      <style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0F172A;font-size:13px;line-height:1.65;}
      .wrap{max-width:760px;margin:0 auto;padding:40px 44px;}
      .top{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:18px;border-bottom:3px solid #3B82F6;}
      .marca{font-size:27px;font-weight:800;color:#3B82F6;letter-spacing:-.5px;line-height:1;}.marca span{color:#0F172A;}
      .sub{font-size:10px;color:#64748B;letter-spacing:.12em;margin-top:4px;font-weight:700;}
      .meta{text-align:right;font-size:12px;color:#475569;}
      .faixa{background:linear-gradient(135deg,#3B82F6,#6366F1);color:#fff;border-radius:12px;padding:16px 22px;margin:18px 0 8px;}
      .faixa .nm{font-size:18px;font-weight:800;}.faixa .sb{font-size:11px;opacity:.9;margin-top:3px;}
      .bt{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;border-left:3px solid #3B82F6;padding-left:9px;margin:18px 0 5px;}
      .bx{font-size:13px;color:#334155;padding-left:12px;}
      .exs{padding-left:30px;margin-top:4px;}.exs li{font-size:13px;color:#334155;margin-bottom:3px;}
      .ass{margin-top:54px;display:flex;justify-content:center;}
      .ass div{text-align:center;border-top:1px solid #475569;padding-top:7px;width:320px;font-size:12px;color:#475569;}
      .foot{margin-top:28px;border-top:1px solid #E2E8F0;padding-top:13px;font-size:10px;color:#94A3B8;text-align:center;}
      @media print{.wrap{padding:24px 26px;}button{display:none;}}</style></head><body><div class="wrap">
      <div class="top"><div><div class="marca">Fisio<span>Piede</span></div><div class="sub">HEALTH TECH PLATFORM</div></div>
      <div class="meta">Laudo Clínico<br>Emitido em ${esc(hoje)}</div></div>
      <div class="faixa"><div class="nm">${esc(paciente.nome)} ${esc(paciente.sobrenome||"")}</div><div class="sb">${idadeP} · ${esc(paciente.sexo||"")} · Nº calçado ${esc(paciente.numeracao||"—")} · Patologia: ${esc(paciente.patologia||"—")}</div></div>
      ${bloco("Resumo clínico", resumoIA.resumo_clinico, "#3B82F6")}
      ${bloco("Achados biomecânicos", resumoIA.achados, "#3B82F6")}
      ${bloco("Plano terapêutico", resumoIA.plano_terapeutico, "#059669")}
      ${exs}
      ${bloco("Retorno sugerido", resumoIA.retorno, "#F59E0B")}
      <div class="ass"><div>Fisioterapeuta responsável</div></div>
      <div class="foot">FisioPiede Health Tech Platform • Laudo gerado com apoio de IA • Documento de uso clínico — requer validação do profissional</div>
      </div><script>window.onload=function(){setTimeout(function(){window.print();},350);};<\/script></body></html>`;
    const w = window.open("","_blank"); if(!w){ alert("Permita pop-ups para gerar o laudo."); return; }
    w.document.open(); w.document.write(html); w.document.close();
  };
  return (
    <Modal onClose={onClose}>
      <Card hover={false} p={0} style={{width:"100%",maxWidth:860,maxHeight:"94vh",display:"flex",flexDirection:"column",animation:"fadeUp .22s ease"}}>
        <div style={{padding:"16px 22px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",background:`linear-gradient(135deg,${C.accent}08,${C.purple}05)`}}>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            <div style={{width:48,height:48,borderRadius:14,background:`linear-gradient(135deg,${C.accent}40,${C.purple}40)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,fontWeight:900,color:C.accent}}>{paciente.nome.charAt(0)}</div>
            <div>
              <div style={{fontSize:18,fontWeight:900}}>{paciente.nome} {paciente.sobrenome}</div>
              <div style={{fontSize:12,color:C.muted,marginTop:1}}>{idade} anos · {paciente.sexo==="F"?"Feminino":paciente.sexo==="M"?"Masculino":"Outro"} · {paciente.whatsapp} · {paciente.clinica}</div>
            </div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}><Badge label="Prontuário Ativo" color={C.green}/><button onClick={onClose} style={{background:"none",color:C.muted,fontSize:20,padding:"4px 8px"}}>✕</button></div>
        </div>
        <div style={{padding:"10px 22px",borderBottom:`1px solid ${C.border}`,display:"flex",gap:8,flexWrap:"wrap"}}>
          {[["⚖️",(paciente.peso||"—")+" kg"],["📏",(paciente.altura||"—")+" cm"],["👟","Nº "+(paciente.numeracao||"—")],["🏃",paciente.atividade||"—"],["📅","Nasc. "+(paciente.nascimento?fmtD(paciente.nascimento):"—")],["📍",paciente.cidade?(paciente.cidade+"/"+paciente.estado):"—"]].map(([icon,val])=>(
            <div key={icon} style={{display:"flex",alignItems:"center",gap:5,padding:"4px 10px",background:C.bgGlass,border:`1px solid ${C.border}`,borderRadius:99,fontSize:11,color:C.sub}}><span>{icon}</span><span style={{fontWeight:600}}>{val}</span></div>
          ))}
          {imcCalc && <div style={{display:"flex",alignItems:"center",gap:5,padding:"4px 10px",background:`${imcCalc.cor}14`,border:`1px solid ${imcCalc.cor}40`,borderRadius:99,fontSize:11,color:imcCalc.cor,fontWeight:700}}><span>📊</span><span>IMC {imcCalc.valor} · {imcCalc.cls}</span></div>}
        </div>
        <div style={{display:"flex",borderBottom:`1px solid ${C.border}`,padding:"0 22px"}}>
          {ABAS.map(a=>{
            const at=aba===a.id;
            return <button key={a.id} onClick={()=>setAba(a.id)} style={{padding:"11px 16px",fontSize:12,fontWeight:at?700:500,color:at?C.accent:C.muted,background:"none",borderBottom:at?`2px solid ${C.accent}`:"2px solid transparent",display:"flex",alignItems:"center",gap:6,transition:"all .15s",whiteSpace:"nowrap"}}><span>{a.icon}</span>{a.label}</button>;
          })}
        </div>
        <div style={{flex:1,overflowY:"auto",padding:22}}>
          {aba==="timeline"&&(
            <div>
              <div style={{marginBottom:18}}>
                <div style={{fontSize:16,fontWeight:800,display:"flex",alignItems:"center",gap:8}}>🕒 Timeline Clínica 360°</div>
                <div style={{fontSize:11.5,color:C.muted,marginTop:3}}>Toda a história do paciente em ordem cronológica, num só lugar.</div>
              </div>
              {eventosTimeline.length===0 ? (
                <div style={{textAlign:"center",padding:50,color:C.muted}}><div style={{fontSize:42,marginBottom:12}}>🕒</div>Ainda não há registros para este paciente.<br/>Conforme você adiciona avaliações, pedidos, evoluções e exames, eles aparecem aqui automaticamente.</div>
              ) : (
                <div style={{position:"relative",paddingLeft:28}}>
                  {/* linha vertical */}
                  <div style={{position:"absolute",left:9,top:6,bottom:6,width:2,background:`linear-gradient(${C.accent}55,${C.purple}33,transparent)`}}/>
                  {eventosTimeline.map((ev,i)=>(
                    <div key={i} style={{position:"relative",marginBottom:14,animation:`fadeUp .4s ${i*0.04}s ease both`,opacity:0}}>
                      {/* ponto */}
                      <div style={{position:"absolute",left:-27,top:4,width:20,height:20,borderRadius:"50%",background:C.bgCard,border:`2px solid ${ev.cor}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,boxShadow:`0 0 10px ${ev.cor}44`}}>{ev.icon}</div>
                      <Card p={14} style={{border:`1px solid ${ev.cor}25`}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5,gap:8,flexWrap:"wrap"}}>
                          <span style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".04em",color:ev.cor,background:`${ev.cor}14`,padding:"2px 9px",borderRadius:99}}>{ev.tipo}</span>
                          <span style={{fontSize:11,color:C.muted,fontWeight:600}}>{fmtData(ev.data)}</span>
                        </div>
                        <div style={{fontSize:12.5,color:C.sub,lineHeight:1.55}}>{ev.desc}</div>
                        {ev.extra&&<div style={{fontSize:10.5,color:C.muted,marginTop:4}}>por {ev.extra}</div>}
                      </Card>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {aba==="resumo"&&(
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              <Card p={16} style={{background:`linear-gradient(135deg,${C.accent}0A,${C.purple}08)`,border:`1px solid ${C.accent}28`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                  <div>
                    <div style={{fontSize:13,fontWeight:800,color:C.accent}}>✦ Prontuário Inteligente</div>
                    <div style={{fontSize:11,color:C.muted,marginTop:2}}>A IA lê os dados do paciente (patologia, baropodometria, evolução da dor) e gera um resumo clínico.</div>
                  </div>
                  <Btn v="primary" sz="sm" disabled={loadingResumo} onClick={gerarResumoIA}>{loadingResumo?<><Spin sz={13}/> Gerando...</>:"✦ Gerar resumo clínico"}</Btn>
                </div>
                {erroResumo&&<div style={{marginTop:10,fontSize:12,color:C.red}}>{erroResumo}</div>}
                {resumoIA&&(
                  <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:10}}>
                    {[["📋 Resumo clínico",resumoIA.resumo_clinico,C.accent],["🔍 Achados biomecânicos",resumoIA.achados,C.purple],["🦶 Plano terapêutico",resumoIA.plano_terapeutico,C.green],["📅 Retorno sugerido",resumoIA.retorno,C.amber]].map(([t,v,c])=>v&&(
                      <div key={t} style={{background:C.bgCard,border:`1px solid ${c}22`,borderRadius:9,padding:12}}><div style={{fontSize:10,color:c,fontWeight:700,textTransform:"uppercase",marginBottom:4}}>{t}</div><div style={{fontSize:12.5,color:C.sub,lineHeight:1.7}}>{v}</div></div>
                    ))}
                    {Array.isArray(resumoIA.exercicios)&&resumoIA.exercicios.length>0&&<div style={{background:C.bgCard,border:`1px solid ${C.amber}22`,borderRadius:9,padding:12}}><div style={{fontSize:10,color:C.amber,fontWeight:700,textTransform:"uppercase",marginBottom:6}}>💪 Exercícios sugeridos</div>{resumoIA.exercicios.map((e,i)=><div key={i} style={{fontSize:12.5,color:C.sub,padding:"3px 0"}}>{i+1}. {e}</div>)}</div>}
                    <div style={{fontSize:10,color:C.muted,fontStyle:"italic"}}>Gerado por IA como apoio à decisão clínica. Revisão do profissional é necessária.</div>
                    <Btn v="primary" full sz="sm" onClick={gerarLaudoResumoPDF}>📄 Gerar laudo em PDF (com a marca)</Btn>
                  </div>
                )}
              </Card>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
                {[{icon:"🩺",label:"Avaliações",value:dados.avaliacoes.length,color:C.accent},{icon:"📋",label:"Evoluções",value:evos.length,color:C.purple},{icon:"📦",label:"Pedidos",value:dados.pedidos.length,color:C.green},{icon:"🔬",label:"Exames",value:dados.exames.length,color:C.amber},{icon:"💊",label:"Prescrições",value:dados.prescricoes.length,color:C.pink},{icon:"📅",label:"Últ. Consulta",value:paciente.ultimaConsulta,color:C.sub,txt:true}].map((m,i)=>(
                  <Card key={i} p={14}><div style={{fontSize:20,marginBottom:6}}>{m.icon}</div><div style={{fontSize:m.txt?13:22,fontWeight:900,color:m.color}}>{m.value}</div><div style={{fontSize:11,color:C.muted,marginTop:2}}>{m.label}</div></Card>
                ))}
              </div>
              {evos[0]&&<Card p={16} style={{background:`${C.accent}06`,border:`1px solid ${C.accent}18`}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}><div style={{fontSize:11,color:C.accent,fontWeight:700,textTransform:"uppercase"}}>Última Evolução — {evos[0].data}</div>{evos[0].assinada&&<Badge label="✓ Assinada" color={C.green}/>}</div><div style={{fontSize:13,color:C.sub,lineHeight:1.7}}>{evos[0].texto}</div><div style={{fontSize:11,color:C.muted,marginTop:8}}>por {evos[0].prof}</div></Card>}
              <Card p={16}><div style={{fontSize:11,color:C.muted,fontWeight:700,textTransform:"uppercase",marginBottom:12}}>Dados Pessoais</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                  {[["CPF",paciente.cpf||"Não informado"],["E-mail",paciente.email||"—"],["WhatsApp",paciente.whatsapp||"—"],["Endereço",paciente.rua?`${paciente.rua}, ${paciente.numero}`:"—"],["Cidade",paciente.cidade?`${paciente.cidade}/${paciente.estado}`:"—"],["Atividade",paciente.atividade||"—"]].map(([l,v])=>(
                    <div key={l} style={{padding:"8px 10px",background:C.bgGlass,borderRadius:8,border:`1px solid ${C.border}`}}><div style={{fontSize:9,color:C.muted,fontWeight:700,textTransform:"uppercase",marginBottom:2}}>{l}</div><div style={{fontSize:12,fontWeight:600}}>{v}</div></div>
                  ))}
                </div>
              </Card>
            </div>
          )}
          {aba==="avaliacoes"&&(
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              <div style={{display:"flex",justifyContent:"flex-end"}}><Btn v="primary" sz="sm">+ Nova Avaliação</Btn></div>
              {dados.avaliacoes.length===0&&<div style={{textAlign:"center",padding:40,color:C.muted}}><div style={{fontSize:40,marginBottom:10}}>🩺</div>Nenhuma avaliação registrada</div>}
              {dados.avaliacoes.map(av=>(
                <Card key={av.id} p={18}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:14}}><div><div style={{fontSize:15,fontWeight:800}}>{av.tipo}</div><div style={{fontSize:12,color:C.muted,marginTop:2}}>{av.data} · {av.prof}</div></div><Badge label={av.tipo} color={C.accent}/></div>
                  {[["🗣️ Queixa",av.queixa],["🧍 Posturologia",av.posturo],["⚙️ Biomecânica",av.biomecanica],["💡 Conduta",av.conduta]].map(([t,v])=>v&&(
                    <div key={t} style={{marginBottom:12}}><div style={{fontSize:10,color:C.accent,fontWeight:700,textTransform:"uppercase",marginBottom:4}}>{t}</div><div style={{fontSize:13,color:C.sub,lineHeight:1.6,padding:"8px 12px",background:C.bgGlass,borderRadius:8,border:`1px solid ${C.border}`}}>{v}</div></div>
                  ))}
                  <div style={{display:"flex",justifyContent:"space-between",marginTop:8,paddingTop:10,borderTop:`1px solid ${C.border}`}}><span style={{fontSize:11,color:C.muted}}>Retorno: <strong style={{color:C.text}}>{av.retorno}</strong></span><div style={{display:"flex",gap:6}}><Btn v="ghost" sz="sm">✏️ Editar</Btn><Btn v="subtle" sz="sm">📄 PDF</Btn></div></div>
                </Card>
              ))}
            </div>
          )}
          {aba==="evolucao"&&(
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              <div style={{display:"flex",justifyContent:"flex-end"}}><Btn v="primary" sz="sm" onClick={()=>setShowNE(true)}>+ Nova Evolução</Btn></div>
              {showNE&&<Card p={16} style={{border:`1px solid ${C.accent}28`,background:`${C.accent}05`}}>
                <div style={{fontSize:12,color:C.accent,fontWeight:700,textTransform:"uppercase",marginBottom:12}}>Nova Evolução</div>
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  <div><label>Profissional</label><input value={novaEvo.prof} onChange={e=>setNovaEvo(p=>({...p,prof:e.target.value}))}/></div>
                  <div><label>Descrição</label><textarea rows={4} value={novaEvo.descricao} onChange={e=>setNovaEvo(p=>({...p,descricao:e.target.value}))} placeholder="Descreva a evolução clínica..."/></div>
                  <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn v="ghost" sz="sm" onClick={()=>setShowNE(false)}>Cancelar</Btn><Btn v="primary" sz="sm" onClick={salvarEvo} disabled={!novaEvo.descricao.trim()}>Salvar Evolução</Btn></div>
                </div>
              </Card>}
              {evos.length===0&&!showNE&&<div style={{textAlign:"center",padding:40,color:C.muted}}><div style={{fontSize:40,marginBottom:10}}>📋</div>Nenhuma evolução registrada</div>}
              {evos.map((ev,i)=>{
                const isL=i===0;
                return (
                  <div key={ev.id} style={{display:"flex",gap:14,alignItems:"flex-start"}}>
                    <div style={{display:"flex",flexDirection:"column",alignItems:"center",paddingTop:4}}>
                      <div style={{width:10,height:10,borderRadius:"50%",background:isL?C.accent:C.muted,boxShadow:isL?`0 0 8px ${C.glow}`:"none",flexShrink:0}}/>
                      {i<evos.length-1&&<div style={{width:2,flex:1,background:C.border,minHeight:40,margin:"4px 0"}}/>}
                    </div>
                    <Card p={14} style={{flex:1,marginBottom:10,border:isL?`1px solid ${C.accent}25`:undefined}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                        <div><div style={{fontSize:12,fontWeight:700,color:isL?C.accent:C.text}}>{ev.data}</div><div style={{fontSize:11,color:C.muted}}>{ev.prof}</div></div>
                        <div style={{display:"flex",gap:6,alignItems:"center"}}>
                          {ev.assinada?<Badge label="✓ Assinada" color={C.green}/>:<Btn v="outline" sz="sm" onClick={()=>setSign(ev.id)}>✍️ Assinar</Btn>}
                        </div>
                      </div>
                      <div style={{fontSize:13,color:C.sub,lineHeight:1.7}}>{ev.texto}</div>
                      {sign===ev.id&&(
                        <div style={{marginTop:10,padding:12,background:`${C.green}08`,border:`1px solid ${C.green}28`,borderRadius:8}}>
                          <div style={{fontSize:11,color:C.green,fontWeight:700,marginBottom:8}}>Assinatura Digital</div>
                          <input placeholder="Digite sua senha para assinar"/>
                          <div style={{display:"flex",gap:6,marginTop:8,justifyContent:"flex-end"}}>
                            <Btn v="ghost" sz="sm" onClick={()=>setSign(null)}>Cancelar</Btn>
                            <Btn v="success" sz="sm" onClick={()=>{setEvos(p=>p.map(e=>e.id===ev.id?{...e,assinada:true}:e));setSign(null);}}>✓ Confirmar</Btn>
                          </div>
                        </div>
                      )}
                    </Card>
                  </div>
                );
              })}
            </div>
          )}
          {aba==="pedidos"&&(
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {dados.pedidos.length===0&&<div style={{textAlign:"center",padding:40,color:C.muted}}><div style={{fontSize:40,marginBottom:10}}>📦</div>Nenhum pedido registrado</div>}
              {dados.pedidos.map(p=>(
                <Card key={p.id} p={14}>
                  <div style={{display:"flex",alignItems:"center",gap:12}}>
                    <span style={{fontFamily:"'Space Mono',monospace",fontSize:11,color:C.accent,fontWeight:700,width:48,flexShrink:0}}>{p.id}</span>
                    <div style={{flex:1}}><div style={{fontSize:13,fontWeight:700}}>{p.tipo}</div><div style={{fontSize:11,color:C.muted}}>{p.data}</div></div>
                    <SBadge status={p.status}/>
                    <span style={{fontSize:13,fontWeight:800,color:C.green}}>{p.valor}</span>
                  </div>
                </Card>
              ))}
            </div>
          )}
          {aba==="exames"&&(
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div style={{fontSize:12,color:C.muted}}>{dados.exames.length} exame{dados.exames.length!==1?"s":""} anexado{dados.exames.length!==1?"s":""}</div><Btn v="primary" sz="sm">+ Anexar Exame</Btn></div>
              {dados.exames.length===0&&<div style={{textAlign:"center",padding:40,color:C.muted}}><div style={{fontSize:40,marginBottom:10}}>🔬</div>Nenhum exame anexado</div>}
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:10}}>
                {dados.exames.map(ex=>(
                  <Card key={ex.id} p={14}>
                    <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                      <div style={{width:36,height:36,borderRadius:9,background:ex.tipo==="PDF"?`${C.red}18`:`${C.accent}18`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{ex.tipo==="PDF"?"📄":"🖼️"}</div>
                      <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ex.nome}</div><div style={{fontSize:10,color:C.muted,marginTop:1}}>{ex.data}</div><div style={{fontSize:11,color:C.sub,marginTop:4,lineHeight:1.4}}>{ex.obs}</div></div>
                    </div>
                    <div style={{display:"flex",gap:5,marginTop:10}}><Btn v="ghost" sz="sm" style={{flex:1,justifyContent:"center"}}>👁 Ver</Btn><Btn v="ghost" sz="sm" style={{flex:1,justifyContent:"center"}}>⬇️ Baixar</Btn></div>
                  </Card>
                ))}
              </div>
              <div style={{border:`2px dashed ${C.border}`,borderRadius:11,padding:24,textAlign:"center",color:C.muted,fontSize:12,cursor:"pointer"}}><div style={{fontSize:28,marginBottom:6}}>📎</div><div style={{fontWeight:600,marginBottom:2}}>Arraste ou clique para anexar</div><div style={{fontSize:10}}>STL · OBJ · JPG · PNG · PDF — máx. 50MB</div></div>
            </div>
          )}
          {aba==="dor"&&(
            <div><EvolucaoDor pacienteId={paciente.id} editavel={false}/></div>
          )}
          {aba==="chat"&&(
            <ChatBox pacienteId={paciente.id} remetente="clinica" nomePaciente={`${paciente.nome} ${paciente.sobrenome}`} nomeClinica={paciente.clinica}/>
          )}
          {aba==="prescricoes"&&(
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              <div style={{display:"flex",justifyContent:"flex-end"}}><Btn v="primary" sz="sm">+ Nova Prescrição</Btn></div>
              {dados.prescricoes.length===0&&<div style={{textAlign:"center",padding:40,color:C.muted}}><div style={{fontSize:40,marginBottom:10}}>💊</div>Nenhuma prescrição registrada</div>}
              {dados.prescricoes.map(pr=>(
                <Card key={pr.id} p={16}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}><div style={{fontSize:12,color:C.muted}}>{pr.data} · {pr.prof}</div><div style={{display:"flex",gap:5}}><Btn v="ghost" sz="sm">✏️</Btn><Btn v="subtle" sz="sm">📄 PDF</Btn></div></div>
                  <div style={{fontSize:13,fontWeight:700,marginBottom:5,color:C.text}}>{pr.item}</div>
                  {pr.obs&&<div style={{fontSize:12,color:C.muted,padding:"6px 10px",background:C.bgGlass,borderRadius:7,border:`1px solid ${C.border}`}}>📌 {pr.obs}</div>}
                </Card>
              ))}
            </div>
          )}
        </div>
        <div style={{padding:"12px 22px",borderTop:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{fontSize:11,color:C.muted}}>Prontuário #{String(paciente.id).padStart(6,"0")} · LGPD Compliant · {new Date().toLocaleDateString("pt-BR")}</div>
          <div style={{display:"flex",gap:8}}><Btn v="subtle" sz="sm">📄 Exportar PDF</Btn><Btn v="ghost" sz="sm" onClick={onClose}>Fechar</Btn></div>
        </div>
      </Card>
    </Modal>
  );
}

// ─── PACIENTES ──────────────────────────────────────────────────────────────────
function ExerciciosPersonalizadosModal({paciente,onClose}) {
  const pac = paciente || {};
  const KEY = "fp:expers:"+pac.id;
  const [lista,setLista] = useState(()=> LS.read(KEY)||[]);
  useEffect(()=>{ (async()=>{ const v=await LS.readAsync(KEY); if(v) setLista(v); })(); },[]);
  const vazio = {nome:"",descricao:"",series:"",repeticoes:"",tempo:"",obs:"",img:""};
  const [f,setF] = useState(vazio);
  const sf = (k,v)=> setF(p=>({...p,[k]:v}));
  const [salvo,setSalvo] = useState("");

  const persist = (nova)=>{ setLista(nova); LS.write(KEY,nova); };

  const addEx = ()=>{
    if(!f.nome.trim()) return;
    persist([...lista, {...f, id:Date.now()}]);
    setF(vazio);
    setSalvo("add"); setTimeout(()=>setSalvo(""),2000);
  };
  const removeEx = (id)=> persist(lista.filter(x=>x.id!==id));

  const onImg = (e)=>{
    const file = e.target.files && e.target.files[0];
    if(!file) return;
    const r = new FileReader();
    r.onload = ()=> sf("img", r.result);
    r.readAsDataURL(file);
  };

  return (
    <Modal onClose={onClose}>
      <Card hover={false} p={0} style={{width:"100%",maxWidth:640,maxHeight:"92vh",overflowY:"auto",animation:"fadeUp .25s ease"}}>
        <div style={{padding:"15px 20px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div><div style={{fontSize:16,fontWeight:800}}>💪 Exercícios personalizados</div><div style={{fontSize:11,color:C.muted}}>{pac.nome} {pac.sobrenome||""}</div></div>
          <button onClick={onClose} style={{background:"none",color:C.muted,fontSize:18}}>✕</button>
        </div>
        <div style={{padding:20,display:"flex",flexDirection:"column",gap:16}}>
          {/* Formulário de novo exercício */}
          <div>
            <div style={{fontSize:10,color:C.green,fontWeight:700,textTransform:"uppercase",marginBottom:10}}>▸ Adicionar exercício</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
              <div style={{gridColumn:"1 / -1"}}><label>Nome do exercício *</label><input value={f.nome} onChange={e=>sf("nome",e.target.value)} placeholder="Ex: Alongamento de panturrilha"/></div>
              <div><label>Séries</label><input value={f.series} onChange={e=>sf("series",e.target.value)} placeholder="3"/></div>
              <div><label>Repetições</label><input value={f.repeticoes} onChange={e=>sf("repeticoes",e.target.value)} placeholder="15"/></div>
              <div><label>Tempo</label><input value={f.tempo} onChange={e=>sf("tempo",e.target.value)} placeholder="30 seg"/></div>
              <div style={{gridColumn:"1 / -1"}}><label>Descrição / Como fazer</label><textarea rows={3} value={f.descricao} onChange={e=>sf("descricao",e.target.value)} placeholder="Explique como o paciente deve executar o exercício..."/></div>
              <div style={{gridColumn:"1 / -1"}}><label>Observações</label><input value={f.obs} onChange={e=>sf("obs",e.target.value)} placeholder="Ex: parar se sentir dor"/></div>
              <div style={{gridColumn:"1 / -1"}}>
                <label>Imagem (opcional)</label>
                <label style={{display:"block",border:`2px dashed ${f.img?C.green:C.border}`,borderRadius:9,padding:14,textAlign:"center",color:C.muted,fontSize:11,cursor:"pointer"}}>
                  <input type="file" accept=".jpg,.jpeg,.png" style={{display:"none"}} onChange={onImg}/>
                  {f.img ? "✓ Imagem selecionada (clique para trocar)" : "📎 Clique para anexar uma foto do exercício"}
                </label>
                {f.img && <img src={f.img} alt="" style={{marginTop:8,maxHeight:120,borderRadius:8}}/>}
              </div>
            </div>
            <div style={{display:"flex",justifyContent:"flex-end",marginTop:10}}>
              <Btn v="primary" disabled={!f.nome.trim()} onClick={addEx}>+ Adicionar exercício</Btn>
            </div>
            {salvo==="add" && <div style={{marginTop:8,padding:9,background:`${C.green}10`,border:`1px solid ${C.green}28`,borderRadius:8,color:C.green,fontSize:12,textAlign:"center"}}>✓ Exercício adicionado! O paciente já consegue ver no portal.</div>}
          </div>

          {/* Lista de exercícios cadastrados */}
          <div>
            <div style={{fontSize:10,color:C.accent,fontWeight:700,textTransform:"uppercase",marginBottom:10}}>▸ Exercícios cadastrados ({lista.length})</div>
            {lista.length===0 ? (
              <div style={{padding:18,textAlign:"center",color:C.muted,fontSize:12,border:`1px dashed ${C.border}`,borderRadius:9}}>Nenhum exercício personalizado ainda.</div>
            ) : (
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {lista.map(ex=>(
                  <div key={ex.id} style={{display:"flex",gap:10,alignItems:"center",padding:"8px 10px",background:C.bgGlass,border:`1px solid ${C.border}`,borderRadius:8}}>
                    {ex.img && <img src={ex.img} alt="" style={{width:42,height:42,borderRadius:6,objectFit:"cover",flexShrink:0}}/>}
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ex.nome}</div>
                      <div style={{fontSize:10,color:C.muted}}>{[ex.series&&`${ex.series} séries`,ex.repeticoes&&`${ex.repeticoes} rep`,ex.tempo].filter(Boolean).join(" · ")||"—"}</div>
                    </div>
                    <Btn v="ghost" sz="sm" onClick={()=>removeEx(ex.id)}>🗑️</Btn>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{display:"flex",justifyContent:"flex-end"}}><Btn v="outline" onClick={onClose}>Fechar</Btn></div>
        </div>
      </Card>
    </Modal>
  );
}

function PacientesPage({pacientes,setPacientes,isAdmin,clinicaId,clinicaName,planoClinica,planoIA}) {
  const portalLiberado = planoClinica==="Premium" || planoClinica==="Enterprise";
  const [search,setSearch]   = useState("");
  const [showForm,setShowForm] = useState(false);
  const [pront,setPront]     = useState(null);
  const [exercPac,setExercPac] = useState(null);
  const [f,setF] = useState({nome:"",sobrenome:"",nascimento:"",cpf:"",sexo:"M",peso:"",altura:"",numeracao:"",atividade:"",whatsapp:"",email:"",cep:"",rua:"",numero:"",complemento:"",cidade:"",estado:"",usuario:"",senha:"",patologia:"",dataRetorno:""});
  const sf = (k,v) => setF(prev=>({...prev,[k]:v}));
  // Isolamento: clínica recebe apenas seus pacientes já filtrados
  const base = pacientes;
  const delPaciente = (p) => {
    if(!window.confirm(`Excluir o paciente ${p.nome} ${p.sobrenome||""}? Esta ação não pode ser desfeita.`)) return;
    setPacientes(prev=>prev.filter(x=>x.id!==p.id));
  };
  const vis  = base.filter(p=>`${p.nome} ${p.sobrenome}`.toLowerCase().includes(search.toLowerCase()));
  const [fClinica,setFClinica] = useState("Todas");
  const clinicasLista = isAdmin ? Array.from(new Set(base.map(p=>p.clinica||"—"))).sort() : [];
  const visClin = isAdmin && fClinica!=="Todas" ? vis.filter(p=>(p.clinica||"—")===fClinica) : vis;
  // Agrupa por clínica (só admin): { nomeClinica: [pacientes...] }
  const grupos = {};
  if(isAdmin){ visClin.forEach(p=>{ const k=p.clinica||"—"; (grupos[k]=grupos[k]||[]).push(p); }); }
  const save = async () => {
    if(!f.nome){ alert("Informe o nome do paciente."); return; }
    if(!f.numeracao || !String(f.numeracao).trim()){ alert("⚠️ O NÚMERO DO CALÇADO é obrigatório.\n\nInforme a numeração do paciente para concluir o cadastro."); return; }
    const cred = f.senha ? await SENHA_FP.criar(f.senha) : {};
    const limpo = { ...f }; delete limpo.senha;
    setPacientes(p=>[...p,{id:Date.now(),...limpo,...cred,clinicaId:clinicaId||null,clinica:clinicaName||"—",pedidos:0,ultimaConsulta:"—"}]);
    setF({nome:"",sobrenome:"",nascimento:"",cpf:"",sexo:"M",peso:"",altura:"",numeracao:"",atividade:"",whatsapp:"",email:"",cep:"",rua:"",numero:"",complemento:"",cidade:"",estado:"",usuario:"",senha:"",patologia:"",dataRetorno:""});
    setShowForm(false);
  };
  const genSenha = () => { const s = "fp"+Math.floor(1000+Math.random()*9000); sf("senha",s); };
  return (
    <div style={{padding:20}}>
      <SH title="Pacientes" sub={`${visClin.length} cadastrado${visClin.length!==1?"s":""}`} right={<div style={{display:"flex",gap:8}}>{isAdmin&&<select value={fClinica} onChange={e=>setFClinica(e.target.value)} style={{width:170}}><option>Todas</option>{clinicasLista.map(c=><option key={c}>{c}</option>)}</select>}<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar nome..." style={{width:180}}/><Btn v="primary" onClick={()=>setShowForm(true)}>+ Novo Paciente</Btn></div>}/>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:18}}>
        {[{l:"Total",v:base.length,c:C.accent,i:"👥"},{l:"Com Pedido",v:base.filter(p=>p.pedidos>0).length,c:C.green,i:"📦"},{l:"Sem Consulta",v:base.filter(p=>p.ultimaConsulta==="—").length,c:C.amber,i:"📅"},{l:isAdmin?"Clínicas":"Minha Clínica",v:isAdmin?new Set(base.map(p=>p.clinica)).size:1,c:C.purple,i:"🏥"}].map((s,i)=>(
          <Card key={i} p={0} style={{overflow:"hidden",position:"relative"}}>
            <div style={{height:3,background:`linear-gradient(90deg,${s.c},${s.c}55)`}}/>
            <div style={{position:"absolute",top:-20,right:-20,width:70,height:70,borderRadius:"50%",background:`radial-gradient(circle,${s.c}14,transparent 70%)`,pointerEvents:"none"}}/>
            <div style={{padding:"13px 15px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div><div style={{fontSize:10.5,color:C.muted,fontWeight:600,marginBottom:2}}>{s.l}</div><div style={{fontSize:22,fontWeight:900,color:s.c,letterSpacing:"-.5px",textShadow:`0 0 16px ${s.c}25`}}>{s.v}</div></div>
              <div style={{width:34,height:34,borderRadius:10,background:`linear-gradient(135deg,${s.c}22,${s.c}0C)`,border:`1px solid ${s.c}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15}}>{s.i}</div>
            </div>
          </Card>
        ))}
      </div>
      {(() => {
        const PacCard = (p, i) => (
          <Card key={p.id} style={{padding:16,animation:`fadeUp .4s ${i*.04}s ease both`,opacity:0}}>
            <div style={{display:"flex",alignItems:"center",gap:11,marginBottom:12}}>
              <div style={{position:"relative"}}>
                <div style={{width:44,height:44,borderRadius:12,background:`linear-gradient(135deg,${C.accent}35,${C.purple}35)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,fontWeight:900,color:C.accent}}>{p.nome.charAt(0)}</div>
                <div style={{position:"absolute",bottom:-2,right:-2,width:10,height:10,borderRadius:"50%",background:p.ultimaConsulta==="—"?C.muted:C.green,border:`2px solid ${C.bgCard}`}}/>
              </div>
              <div style={{flex:1,minWidth:0}}><div style={{fontWeight:800,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.nome} {p.sobrenome}</div><div style={{fontSize:11,color:C.muted}}>{p.whatsapp||p.email||"—"}</div></div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,marginBottom:11}}>
              {[["🏥",p.clinica],["🏃",p.atividade||"—"],["📅",p.ultimaConsulta],["📦",`${p.pedidos} palmilha${p.pedidos!==1?"s":""}`]].map(([icon,val])=>(
                <div key={icon} style={{padding:"5px 8px",background:C.bgGlass,borderRadius:7,border:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:5}}><span style={{fontSize:10}}>{icon}</span><span style={{fontSize:10,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{val}</span></div>
              ))}
            </div>
            <div style={{display:"flex",gap:5}}>
              <Btn v="primary" sz="sm" style={{flex:1,justifyContent:"center"}} onClick={()=>setPront(p)}>📋 Prontuário</Btn>
              <Btn v="ghost"   sz="sm" style={{flex:1,justifyContent:"center"}} onClick={()=>setExercPac(p)}>💪 Exercícios</Btn>
              {isAdmin&&<Btn v="ghost" sz="sm" onClick={()=>delPaciente(p)} style={{color:C.red}}>🗑️</Btn>}
            </div>
          </Card>
        );
        const grade = (arr) => <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(270px,1fr))",gap:12}}>{arr.map(PacCard)}</div>;
        if(!isAdmin) return grade(visClin);
        const nomes = Object.keys(grupos).sort();
        if(nomes.length===0) return <div style={{textAlign:"center",padding:40,color:C.muted}}>Nenhum paciente encontrado.</div>;
        return nomes.map(nome => (
          <div key={nome} style={{marginBottom:22}}>
            <div style={{display:"flex",alignItems:"center",gap:8,margin:"4px 0 10px"}}>
              <span style={{fontSize:14,fontWeight:800,color:C.text}}>🏥 {nome}</span>
              <span style={{fontSize:11,color:C.muted,background:C.bgGlass,border:`1px solid ${C.border}`,borderRadius:99,padding:"2px 9px"}}>{grupos[nome].length} paciente{grupos[nome].length!==1?"s":""}</span>
            </div>
            {grade(grupos[nome])}
          </div>
        ));
      })()}
      {pront&&<ProntuarioModal paciente={pront} onClose={()=>setPront(null)} clinicaId={clinicaId} planoIA={planoIA||(isAdmin?"admin":planoClinica)}/>}
      {exercPac&&<ExerciciosPersonalizadosModal paciente={exercPac} onClose={()=>setExercPac(null)}/>}
      {showForm&&(
        <Modal onClose={()=>setShowForm(false)}>
          <Card hover={false} p={0} style={{width:"100%",maxWidth:640,maxHeight:"92vh",overflowY:"auto",animation:"fadeUp .25s ease"}}>
            <div style={{padding:"15px 20px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}><div style={{fontSize:16,fontWeight:800}}>Novo Paciente</div><button onClick={()=>setShowForm(false)} style={{background:"none",color:C.muted,fontSize:18}}>✕</button></div>
            <div style={{padding:20,display:"flex",flexDirection:"column",gap:16}}>
              <div>
                <div style={{fontSize:10,color:C.accent,fontWeight:700,textTransform:"uppercase",marginBottom:10}}>▸ Dados Pessoais</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
                  {[{l:"Nome",k:"nome"},{l:"Sobrenome",k:"sobrenome"},{l:"Data Nasc.",k:"nascimento",t:"date"},{l:"CPF",k:"cpf"},{l:"WhatsApp",k:"whatsapp"},{l:"E-mail",k:"email",t:"email"}].map(fi=>(
                    <div key={fi.k}><label>{fi.l}</label><input type={fi.t||"text"} value={f[fi.k]} onChange={e=>sf(fi.k,e.target.value)}/></div>
                  ))}
                  <div><label>Sexo</label><select value={f.sexo} onChange={e=>sf("sexo",e.target.value)}><option value="M">Masculino</option><option value="F">Feminino</option><option value="O">Outro</option></select></div>
                </div>
              </div>
              <div>
                <div style={{fontSize:10,color:C.accent,fontWeight:700,textTransform:"uppercase",marginBottom:10}}>▸ Dados Clínicos</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
                  {[{l:"Peso (kg)",k:"peso"},{l:"Altura (cm)",k:"altura"},{l:"Nº Calçado *",k:"numeracao"},{l:"Atividade",k:"atividade"}].map(fi=>(
                    <div key={fi.k}><label>{fi.l}</label><input value={f[fi.k]} onChange={e=>sf(fi.k,e.target.value)}/></div>
                  ))}
                </div>
              </div>
              <div>
                <div style={{fontSize:10,color:C.accent,fontWeight:700,textTransform:"uppercase",marginBottom:10}}>▸ Endereço</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 2fr 1fr",gap:10}}>
                  <div><label>CEP</label><input value={f.cep} onChange={e=>sf("cep",e.target.value)} placeholder="00000-000"/></div>
                  <div><label>Rua</label><input value={f.rua} onChange={e=>sf("rua",e.target.value)}/></div>
                  <div><label>Número</label><input value={f.numero} onChange={e=>sf("numero",e.target.value)}/></div>
                  <div><label>Complemento</label><input value={f.complemento} onChange={e=>sf("complemento",e.target.value)}/></div>
                  <div><label>Cidade</label><input value={f.cidade} onChange={e=>sf("cidade",e.target.value)}/></div>
                  <div><label>Estado</label><input value={f.estado} onChange={e=>sf("estado",e.target.value)} placeholder="SP"/></div>
                </div>
              </div>
              <div>
                <div style={{fontSize:10,color:C.purple,fontWeight:700,textTransform:"uppercase",marginBottom:10}}>▸ Patologia / Diagnóstico</div>
                <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:10}}>
                  <div>
                    <label>Patologia do Paciente</label>
                    <select value={f.patologia} onChange={e=>sf("patologia",e.target.value)}>
                      <option value="">— Selecione —</option>
                      {Object.keys(PROTOCOLOS_FP).map(k=><option key={k} value={k}>{PROTOCOLOS_FP[k].icon} {k}</option>)}
                    </select>
                  </div>
                  <div><label>Data de Retorno</label><input type="date" value={f.dataRetorno} onChange={e=>sf("dataRetorno",e.target.value)}/></div>
                </div>
              </div>
              <div>
                <div style={{fontSize:10,color:C.green,fontWeight:700,textTransform:"uppercase",marginBottom:10}}>▸ Acesso do Paciente (Portal)</div>
                {portalLiberado ? (
                  <>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:10,alignItems:"end"}}>
                      <div><label>Usuário (e-mail/login)</label><input value={f.usuario} onChange={e=>sf("usuario",e.target.value)} placeholder={f.email||"login do paciente"}/></div>
                      <div><label>Senha</label><input value={f.senha} onChange={e=>sf("senha",e.target.value)} placeholder="senha de acesso"/></div>
                      <Btn v="subtle" sz="sm" onClick={genSenha}>🎲 Gerar</Btn>
                    </div>
                    <div style={{fontSize:10,color:C.muted,marginTop:6}}>O paciente usa esse login para acessar o portal com sua patologia, exercícios e data de retorno.</div>
                  </>
                ) : (
                  <div style={{padding:"14px 16px",background:`linear-gradient(135deg,${C.purple}12,${C.accent}06)`,border:`1px solid ${C.purple}28`,borderRadius:10,display:"flex",alignItems:"center",gap:12}}>
                    <span style={{fontSize:26}}>🔒</span>
                    <div style={{flex:1}}>
                      <div style={{fontSize:12,fontWeight:800,color:C.text}}>Portal do Paciente disponível nos planos Premium e Enterprise</div>
                      <div style={{fontSize:11,color:C.sub,marginTop:3,lineHeight:1.5}}>Faça upgrade para criar logins e liberar o acesso do paciente aos exercícios, patologia e acompanhamento. Você ainda pode cadastrar o paciente normalmente — só o acesso ao portal fica bloqueado.</div>
                    </div>
                  </div>
                )}
              </div>
              <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn v="ghost" onClick={()=>setShowForm(false)}>Cancelar</Btn><Btn v="primary" disabled={!f.nome} onClick={save}>Cadastrar →</Btn></div>
            </div>
          </Card>
        </Modal>
      )}
    </div>
  );
}

// ─── AVALIAÇÃO ─────────────────────────────────────────────────────────────────
function AvaliacaoPage({pacientes}) {
  const [f,setF]       = useState({paciente:"",tipoCalcado:"",posturo:"",biomecanica:"",obs:""});
  const [exames,setExames] = useState([]);
  const sf = (k,v) => setF(prev=>({...prev,[k]:v}));
  const [saved,setSaved] = useState("");
  const [checks,setChecks] = useState({});
  const items = ["Análise da marcha","Teste de Romberg","Pronação/supinação","Baropodometria","Fotopodograma","Medição dos arcos","Teste de Thomas","Avaliação de joelhos","Análise pélvica","Avaliação cervical"];
  return (
    <div style={{padding:20}}>
      <SH title="Avaliação Postural" sub="Formulário biomecânico completo"/>
      <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:16}}>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <Card p={18}>
            <div style={{fontSize:10,color:C.accent,fontWeight:700,textTransform:"uppercase",marginBottom:12}}>▸ Dados do Paciente</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:11}}>
              <div style={{gridColumn:"1 / -1"}}><label>Paciente</label><select value={f.paciente} onChange={e=>sf("paciente",e.target.value)}><option value="">— Selecione —</option>{pacientes.map(p=><option key={p.id}>{p.nome} {p.sobrenome}</option>)}</select></div>
              <div><label>Tipo de Calçado</label><select value={f.tipoCalcado} onChange={e=>sf("tipoCalcado",e.target.value)}><option value="">—</option><option>Tênis</option><option>Social</option><option>Chinelo</option><option>Sandália</option></select></div>
            </div>
          </Card>
          {[["▸ Posturologia","posturo","Alinhamento corporal, desvios posturais..."],["▸ Biomecânica","biomecanica","Padrão de marcha, apoio plantar, distribuição de carga..."],["▸ Obs. Clínicas","obs","Queixa principal, diagnóstico, prescrição..."]].map(([titulo,k,ph])=>(
            <Card key={k} p={18}><div style={{fontSize:10,color:C.accent,fontWeight:700,textTransform:"uppercase",marginBottom:10}}>{titulo}</div><textarea rows={4} value={f[k]} onChange={e=>sf(k,e.target.value)} placeholder={ph}/></Card>
          ))}
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            <Btn v="ghost" onClick={()=>{setSaved("rascunho");setTimeout(()=>setSaved(""),2500);}}>💾 Rascunho</Btn>
            <Btn v="primary" disabled={!f.paciente} onClick={()=>{setSaved("ok");setTimeout(()=>setSaved(""),2500);}}>✓ Finalizar</Btn>
          </div>
          {saved&&<div style={{padding:11,background:saved==="ok"?`${C.green}10`:`${C.amber}10`,border:`1px solid ${saved==="ok"?C.green:C.amber}28`,borderRadius:9,color:saved==="ok"?C.green:C.amber,fontSize:12,textAlign:"center"}}>✓ {saved==="ok"?"Avaliação finalizada!":"Rascunho salvo!"}</div>}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <Card p={16}>
            <div style={{fontWeight:800,fontSize:13,marginBottom:12}}>Checklist Biomecânico</div>
            {items.map((item,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:i<items.length-1?`1px solid ${C.border}`:"none",cursor:"pointer"}} onClick={()=>setChecks(p=>{const n={...p};n[i]=!p[i];return n;})}>
                <div style={{width:14,height:14,borderRadius:3,border:`1.5px solid ${checks[i]?C.green:C.border}`,background:checks[i]?C.green:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:9,color:"#fff"}}>{checks[i]?"✓":""}</div>
                <span style={{fontSize:11,color:checks[i]?C.text:C.muted}}>{item}</span>
              </div>
            ))}
          </Card>
          <Card p={16}>
            <div style={{fontWeight:800,fontSize:13,marginBottom:10}}>Upload de Exames</div>
            <label style={{display:"block",border:`2px dashed ${exames.length?C.green:C.border}`,borderRadius:9,padding:18,textAlign:"center",color:C.muted,fontSize:11,cursor:"pointer",transition:"all .15s"}}>
              <input type="file" multiple accept=".jpg,.jpeg,.png,.pdf" style={{display:"none"}}
                onChange={async e=>{
                  const files=Array.from(e.target.files||[]);
                  const mapped=await Promise.all(files.map(file=>new Promise(res=>{
                    const r=new FileReader();
                    r.onload=()=>res({nome:file.name,ext:file.name.split(".").pop().toUpperCase(),size:(file.size/1024/1024).toFixed(2)+"MB",dataUrl:r.result});
                    r.onerror=()=>res(null);
                    r.readAsDataURL(file);
                  })));
                  setExames(prev=>[...prev,...mapped.filter(Boolean)]);
                }}/>
              <div style={{fontSize:22,marginBottom:5}}>📎</div>
              Clique para anexar<br/>Baropodometria · Raio-X · Fotos · PDF
            </label>
            {exames.length>0&&(
              <div style={{marginTop:10,display:"flex",flexDirection:"column",gap:6}}>
                {exames.map((ex,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",background:C.bgGlass,borderRadius:8,border:`1px solid ${C.border}`}}>
                    <span style={{fontSize:14}}>{ex.ext==="PDF"?"📄":"🖼️"}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:11,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ex.nome}</div>
                      <div style={{fontSize:9,color:C.muted}}>{ex.size}</div>
                    </div>
                    <a href={ex.dataUrl} download={ex.nome} style={{fontSize:10,color:C.green,fontWeight:700,textDecoration:"none"}}>⬇️</a>
                    <button onClick={()=>setExames(prev=>prev.filter((_,idx)=>idx!==i))} style={{background:"none",color:C.red,fontSize:13}}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

// ─── AGENDA ────────────────────────────────────────────────────────────────────
// ─── HELPERS DE DATA ──────────────────────────────────────────────────────────
function getWeekStart(refDate) {
  const d = new Date(refDate);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  d.setHours(0,0,0,0);
  return d;
}
function fmtDate(d) {
  return d.toISOString().split("T")[0];
}
function fmtDateBR(iso) {
  return iso ? iso.split("-").reverse().join("/") : "—";
}
function dayName(d) {
  return ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"][d.getDay()];
}

const TIPO_CORES = {
  "Consulta Inicial":    "#3B82F6",
  "Retorno":             "#10B981",
  "Avaliação Postural":  "#8B5CF6",
  "Baropodometria":      "#F59E0B",
  "Entrega de Palmilha": "#EC4899",
  "Ajuste de Palmilha":  "#64748B",
};
const TIPOS = Object.keys(TIPO_CORES);
const HORAS = ["08:00","08:30","09:00","09:30","10:00","10:30","11:00","11:30",
               "12:00","12:30","13:00","13:30","14:00","14:30","15:00","15:30",
               "16:00","16:30","17:00","17:30","18:00"];

function NovaConsultaModal({onClose, onSave, pacientes, clinicaId, editData}) {
  const today = fmtDate(new Date());
  const [f, setF] = useState(editData || {
    paciente:"", data:today, hora:"09:00", duracao:"60",
    tipo:"Consulta Inicial", notas:"", status:"Agendada"
  });
  const [err, setErr] = useState("");
  const sf = (k,v) => { setF(p=>({...p,[k]:v})); setErr(""); };

  const save = () => {
    if (!f.paciente) { setErr("Selecione um paciente."); return; }
    if (!f.data)     { setErr("Informe a data."); return; }
    onSave({
      id: editData?.id || Date.now(),
      clinicaId,
      ...f,
    });
    onClose();
  };

  return (
    <Modal onClose={onClose}>
      <Card hover={false} p={0} style={{width:"100%",maxWidth:520,animation:"fadeUp .22s ease"}}>
        <div style={{padding:"15px 20px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",background:`linear-gradient(135deg,${C.accent}08,${C.purple}04)`}}>
          <div style={{fontSize:16,fontWeight:800}}>{editData?"Editar Consulta":"Nova Consulta"}</div>
          <button onClick={onClose} style={{background:"none",color:C.muted,fontSize:18}}>✕</button>
        </div>
        <div style={{padding:20,display:"flex",flexDirection:"column",gap:12}}>
          <div>
            <label>Paciente *</label>
            <select value={f.paciente} onChange={e=>sf("paciente",e.target.value)}>
              <option value="">— Selecione —</option>
              {pacientes.map(p=><option key={p.id}>{p.nome} {p.sobrenome}</option>)}
            </select>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div>
              <label>Data *</label>
              <input type="date" value={f.data} onChange={e=>sf("data",e.target.value)}/>
            </div>
            <div>
              <label>Horário</label>
              <select value={f.hora} onChange={e=>sf("hora",e.target.value)}>
                {HORAS.map(h=><option key={h}>{h}</option>)}
              </select>
            </div>
            <div>
              <label>Tipo de Consulta</label>
              <select value={f.tipo} onChange={e=>sf("tipo",e.target.value)}>
                {TIPOS.map(t=><option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label>Duração</label>
              <select value={f.duracao} onChange={e=>sf("duracao",e.target.value)}>
                <option value="30">30 minutos</option>
                <option value="60">1 hora</option>
                <option value="90">1h 30min</option>
                <option value="120">2 horas</option>
              </select>
            </div>
          </div>
          <div>
            <label>Status</label>
            <select value={f.status} onChange={e=>sf("status",e.target.value)}>
              <option>Agendada</option>
              <option>Confirmada</option>
              <option>Concluída</option>
              <option>Cancelada</option>
            </select>
          </div>
          <div>
            <label>Observações</label>
            <textarea rows={3} value={f.notas} onChange={e=>sf("notas",e.target.value)} placeholder="Motivo da consulta, observações..."/>
          </div>
          {err && <div style={{padding:"8px 12px",background:`${C.red}10`,border:`1px solid ${C.red}28`,borderRadius:8,fontSize:12,color:C.red}}>⚠️ {err}</div>}
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            <Btn v="ghost" onClick={onClose}>Cancelar</Btn>
            <Btn v="primary" onClick={save}>{editData?"Salvar Alterações":"Agendar →"}</Btn>
          </div>
        </div>
      </Card>
    </Modal>
  );
}

function AgendaPage({consultas, setConsultas, pacientes, clinicaId, isAdmin}) {
  // Lembrete por WhatsApp: acha o telefone do paciente pelo nome e monta a mensagem pronta
  const zapLembrete = (c) => {
    const p = (pacientes||[]).find(p=>(`${p.nome||""} ${p.sobrenome||""}`.trim().toLowerCase())===String(c.paciente||"").trim().toLowerCase());
    const d = ((p&&p.whatsapp)||"").replace(/\D/g,"");
    if(!d) return null;
    const dataBr = (c.data||"").split("-").reverse().join("/");
    const msg = `Olá, ${String(c.paciente||"").split(" ")[0]}! 😊 Passando para lembrar do seu compromisso: ${c.tipo||"consulta"} no dia ${dataBr} às ${c.hora}. Qualquer imprevisto, é só avisar. Até lá! 🦶`;
    return "https://wa.me/"+(d.length<=11?"55"+d:d)+"?text="+encodeURIComponent(msg);
  };
  const [weekOffset, setWeekOffset] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [editData, setEditData]   = useState(null);
  const [selC, setSelC]           = useState(null);
  const [viewMode, setViewMode]   = useState("semana"); // semana | lista

  const today    = new Date();
  const refDate  = new Date(today.getTime() + weekOffset * 7 * 86400000);
  const wStart   = getWeekStart(refDate);
  const weekDays = Array.from({length:7}, (_,i) => {
    const d = new Date(wStart);
    d.setDate(wStart.getDate()+i);
    return d;
  });

  const ROWS = ["08","09","10","11","12","13","14","15","16","17","18"];

  // Filtra consultas: clínica vê só as suas
  const minhas = clinicaId
    ? consultas.filter(c => c.clinicaId === clinicaId)
    : consultas;

  // Consultas da semana atual
  const weekStr = weekDays.map(fmtDate);
  const semanaConsultas = minhas.filter(c => weekStr.includes(c.data));

  // Consultas de um slot (dia + hora)
  const getSlot = (dayIso, hh) =>
    semanaConsultas.filter(c => c.data === dayIso && c.hora.startsWith(hh+":"));

  const handleSave = (consulta) => {
    if (editData) {
      setConsultas(p => p.map(c => c.id===consulta.id ? consulta : c));
    } else {
      setConsultas(p => [...p, consulta]);
    }
    setEditData(null);
    setShowModal(false);
  };

  const handleDelete = (id) => {
    setConsultas(p => p.filter(c => c.id !== id));
    setSelC(null);
  };

  const handleStatus = (id, status) => {
    setConsultas(p => p.map(c => c.id===id ? {...c, status} : c));
    setSelC(c => c && c.id===id ? {...c, status} : c);
  };

  const semanaLabel = () => {
    const s = weekDays[0], e = weekDays[6];
    const fmt = d => `${d.getDate().toString().padStart(2,"0")}/${(d.getMonth()+1).toString().padStart(2,"0")}`;
    return `${fmt(s)} — ${fmt(e)} de ${e.toLocaleDateString("pt-BR",{month:"long",year:"numeric"})}`;
  };

  const isToday = (d) => fmtDate(d) === fmtDate(today);

  const statusColor = s => s==="Concluída"?C.green:s==="Cancelada"?C.red:s==="Confirmada"?C.accent:C.amber;

  return (
    <div style={{padding:20}}>
      <SH title="Agenda de Consultas"
        sub={semanaLabel()}
        right={
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <div style={{display:"flex",background:C.bgGlass,border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden"}}>
              <button onClick={()=>setViewMode("semana")} style={{padding:"7px 14px",background:viewMode==="semana"?`${C.accent}20`:"transparent",color:viewMode==="semana"?C.accent:C.muted,fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>Semana</button>
              <button onClick={()=>setViewMode("lista")} style={{padding:"7px 14px",background:viewMode==="lista"?`${C.accent}20`:"transparent",color:viewMode==="lista"?C.accent:C.muted,fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>Lista</button>
            </div>
            <Btn v="ghost" sz="sm" onClick={()=>setWeekOffset(w=>w-1)}>← Anterior</Btn>
            <Btn v="ghost" sz="sm" onClick={()=>setWeekOffset(0)}>Hoje</Btn>
            <Btn v="ghost" sz="sm" onClick={()=>setWeekOffset(w=>w+1)}>Próxima →</Btn>
            <Btn v="primary" sz="sm" onClick={()=>{setEditData(null);setShowModal(true);}}>+ Agendar</Btn>
          </div>
        }
      />

      {/* Stats rápidos da semana */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:14}}>
        {[
          {l:"Agendadas",   v:semanaConsultas.filter(c=>c.status==="Agendada").length,   c:C.amber},
          {l:"Confirmadas", v:semanaConsultas.filter(c=>c.status==="Confirmada").length, c:C.accent},
          {l:"Concluídas",  v:semanaConsultas.filter(c=>c.status==="Concluída").length,  c:C.green},
          {l:"Canceladas",  v:semanaConsultas.filter(c=>c.status==="Cancelada").length,  c:C.red},
          {l:"Total semana",v:semanaConsultas.length, c:C.sub},
        ].map((s,i)=>(
          <Card key={i} p={10} style={{textAlign:"center"}}>
            <div style={{fontSize:20,fontWeight:900,color:s.c}}>{s.v}</div>
            <div style={{fontSize:10,color:C.muted,marginTop:2}}>{s.l}</div>
          </Card>
        ))}
      </div>

      {/* VISÃO SEMANA */}
      {viewMode==="semana" && (
        <Card hover={false} p={0} style={{overflow:"hidden"}}>
          {/* Header dias */}
          <div style={{display:"grid",gridTemplateColumns:"52px repeat(7,1fr)",borderBottom:`1px solid ${C.border}`}}>
            <div/>
            {weekDays.map((d,i)=>{
              const isT = isToday(d);
              const nConsultas = getSlot(fmtDate(d), "").length;
              return (
                <div key={i} style={{padding:"9px 4px",textAlign:"center",borderLeft:`1px solid ${C.border}`,background:isT?`${C.accent}08`:"transparent"}}>
                  <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:".08em"}}>{dayName(d)}</div>
                  <div style={{width:28,height:28,borderRadius:"50%",margin:"3px auto",background:isT?C.accent:"transparent",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:isT?800:400,color:isT?"#fff":C.text}}>{d.getDate()}</div>
                  {nConsultas>0 && <div style={{fontSize:8,color:C.accent,fontWeight:700}}>{nConsultas} consult.</div>}
                </div>
              );
            })}
          </div>
          {/* Grid horas */}
          <div style={{overflowY:"auto",maxHeight:500}}>
            {ROWS.map(hh=>(
              <div key={hh} style={{display:"grid",gridTemplateColumns:"52px repeat(7,1fr)",borderBottom:`1px solid ${C.border}`,minHeight:52}}>
                <div style={{padding:"6px 5px 0",fontSize:9,color:C.muted,fontFamily:"'Space Mono',monospace",flexShrink:0}}>{hh}:00</div>
                {weekDays.map((d,di)=>{
                  const iso = fmtDate(d);
                  const appts = getSlot(iso, hh);
                  const isT = isToday(d);
                  return (
                    <div key={di}
                      style={{borderLeft:`1px solid ${C.border}`,background:isT?`${C.accent}02`:"transparent",padding:"2px 3px",minHeight:52,cursor:"pointer",transition:"background .12s"}}
                      onMouseEnter={e=>{ if(appts.length===0) e.currentTarget.style.background=`${C.accent}06`; }}
                      onMouseLeave={e=>{ e.currentTarget.style.background=isT?`${C.accent}02`:"transparent"; }}
                      onClick={()=>{ if(appts.length===0){ setEditData({data:iso, hora:hh+":00", duracao:"60", tipo:"Consulta Inicial", notas:"", status:"Agendada", paciente:""}); setShowModal(true); } }}
                    >
                      {appts.map((ap,ai)=>{
                        const cor = TIPO_CORES[ap.tipo]||C.accent;
                        const cancelada = ap.status==="Cancelada";
                        return (
                          <div key={ai}
                            onClick={e=>{e.stopPropagation();setSelC(ap);}}
                            style={{borderRadius:5,background:`${cor}18`,border:`1px solid ${cor}35`,padding:"2px 5px",marginBottom:2,cursor:"pointer",opacity:cancelada?.5:1,textDecoration:cancelada?"line-through":"none"}}
                          >
                            <div style={{fontSize:8,fontWeight:800,color:cor,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ap.paciente}</div>
                            <div style={{fontSize:8,color:C.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ap.hora} · {ap.tipo.split(" ")[0]}</div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* VISÃO LISTA */}
      {viewMode==="lista" && (
        <Card hover={false} p={0} style={{overflow:"hidden"}}>
          {minhas.length===0
            ? <div style={{padding:48,textAlign:"center",color:C.muted}}><div style={{fontSize:40,marginBottom:10}}>📅</div>Nenhuma consulta agendada ainda.<br/><span style={{fontSize:12}}>Clique em "+ Agendar" para começar.</span></div>
            : <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                <thead>
                  <tr style={{borderBottom:`1px solid ${C.border}`,background:C.bgGlass}}>
                    {["Data","Horário","Paciente","Tipo","Duração","Status","Ações"].map(h=>(
                      <th key={h} style={{padding:"10px 14px",textAlign:"left",color:C.muted,fontWeight:700,fontSize:9,letterSpacing:".06em",textTransform:"uppercase"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...minhas].sort((a,b)=>a.data.localeCompare(b.data)||(a.hora.localeCompare(b.hora))).map(c=>{
                    const cor = TIPO_CORES[c.tipo]||C.accent;
                    return (
                      <tr key={c.id} style={{borderBottom:`1px solid ${C.border}`,transition:"background .12s"}}
                        onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,.02)"}
                        onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                      >
                        <td style={{padding:"11px 14px",fontWeight:600}}>{fmtDateBR(c.data)}</td>
                        <td style={{padding:"11px 14px",fontFamily:"'Space Mono',monospace",fontSize:11,color:C.accent}}>{c.hora}</td>
                        <td style={{padding:"11px 14px",fontWeight:700}}>{c.paciente}</td>
                        <td style={{padding:"11px 14px"}}><Badge label={c.tipo} color={cor}/></td>
                        <td style={{padding:"11px 14px",color:C.muted,fontSize:12}}>{c.duracao} min</td>
                        <td style={{padding:"11px 14px"}}><Badge label={c.status} color={statusColor(c.status)}/></td>
                        <td style={{padding:"11px 14px"}}>
                          <div style={{display:"flex",gap:4}}>
                            <Btn v="ghost" sz="sm" onClick={()=>setSelC(c)}>👁</Btn>
                            <Btn v="ghost" sz="sm" onClick={()=>{setEditData(c);setShowModal(true);}}>✏️</Btn>
                            <Btn v="danger" sz="sm" onClick={()=>handleDelete(c.id)}>🗑️</Btn>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
          }
        </Card>
      )}

      {/* Legenda */}
      <div style={{display:"flex",gap:10,flexWrap:"wrap",marginTop:10}}>
        {TIPOS.map(t=>(
          <div key={t} style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:C.muted}}>
            <div style={{width:8,height:8,borderRadius:2,background:TIPO_CORES[t]}}/>
            {t}
          </div>
        ))}
      </div>

      {/* MODAL nova/editar consulta */}
      {showModal && (
        <NovaConsultaModal
          onClose={()=>{setShowModal(false);setEditData(null);}}
          onSave={handleSave}
          pacientes={pacientes}
          clinicaId={clinicaId||0}
          editData={editData}
        />
      )}

      {/* MODAL detalhe consulta */}
      {selC && (
        <Modal onClose={()=>setSelC(null)}>
          <Card hover={false} p={0} style={{width:"100%",maxWidth:440,animation:"fadeUp .22s ease"}}>
            <div style={{padding:"15px 20px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",background:`${(TIPO_CORES[selC.tipo]||C.accent)}08`}}>
              <div>
                <div style={{fontSize:16,fontWeight:900}}>{selC.paciente}</div>
                <div style={{fontSize:12,color:C.muted,marginTop:2}}>{fmtDateBR(selC.data)} · {selC.hora} · {selC.duracao}min</div>
              </div>
              <button onClick={()=>setSelC(null)} style={{background:"none",color:C.muted,fontSize:18}}>✕</button>
            </div>
            <div style={{padding:18,display:"flex",flexDirection:"column",gap:12}}>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <Badge label={selC.tipo} color={TIPO_CORES[selC.tipo]||C.accent}/>
                <Badge label={selC.status} color={statusColor(selC.status)}/>
              </div>
              {selC.notas && (
                <div style={{padding:"10px 13px",background:C.bgGlass,border:`1px solid ${C.border}`,borderRadius:9,fontSize:12,color:C.sub,lineHeight:1.6}}>
                  📝 {selC.notas}
                </div>
              )}
              {/* Alterar status rápido */}
              <div>
                <div style={{fontSize:10,color:C.muted,fontWeight:700,textTransform:"uppercase",marginBottom:8}}>Alterar Status</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {["Agendada","Confirmada","Concluída","Cancelada"].map(s=>(
                    <button key={s}
                      onClick={()=>handleStatus(selC.id,s)}
                      style={{padding:"5px 12px",borderRadius:7,fontSize:11,fontWeight:700,
                        background:selC.status===s?`${statusColor(s)}20`:"transparent",
                        color:selC.status===s?statusColor(s):C.muted,
                        border:`1px solid ${selC.status===s?statusColor(s):C.border}`,cursor:"pointer"
                      }}
                    >{s}</button>
                  ))}
                </div>
              </div>
              {(()=>{ const z = zapLembrete(selC); return z
                ? <a href={z} target="_blank" rel="noreferrer" style={{textDecoration:"none",display:"block",marginBottom:8}}><Btn v="success" sz="sm" style={{width:"100%",justifyContent:"center"}}>💬 Lembrar paciente no WhatsApp</Btn></a>
                : <div style={{fontSize:10,color:C.muted,marginBottom:8,textAlign:"center"}}>💬 Cadastre o WhatsApp do paciente para enviar lembretes com 1 clique</div>; })()}
              <div style={{display:"flex",gap:7}}>
                <Btn v="outline" sz="sm" style={{flex:1,justifyContent:"center"}} onClick={()=>{setEditData(selC);setShowModal(true);setSelC(null);}}>✏️ Editar</Btn>
                <Btn v="danger" sz="sm" style={{flex:1,justifyContent:"center"}} onClick={()=>handleDelete(selC.id)}>🗑️ Excluir</Btn>
              </div>
            </div>
          </Card>
        </Modal>
      )}
    </div>
  );
}


function IAPage({pacientes, setPacientes, setPedidos, clinicaId, clinicaName, planoIA}) {
  // 🔄 Sincroniza o contador de IA com a nuvem ao abrir (2 aparelhos = 1 cota só).
  // Prevalece sempre o MAIOR valor, para ninguém "zerar" a cota trocando de computador.
  useEffect(()=>{ (async()=>{
    try{
      const k = IA_USO._key(clinicaId);
      const nuvem = await LS.readAsync(k);
      if(nuvem && typeof nuvem.n === "number"){
        const local = LS.read(k);
        if(!local || typeof local.n!=="number" || local.n < nuvem.n) LS.write(k, nuvem, true);
      }
    }catch(e){}
  })(); },[clinicaId]);
  const [aba, setAba]           = useState("avaliacao");
  const [loading, setLoading]   = useState(false);
  const [erro, setErro]         = useState("");
  const [salvo, setSalvo]       = useState(false);
  const [resultIA, setResultIA] = useState(null);
  const [pacSel, setPacSel]     = useState("");
  const [patologia, setPatologia] = useState("");
  const [queixaInput, setQ]     = useState("");
  const [obsInput, setObs]      = useState("");
  const [rec, setRec]           = useState(false);
  const [transcript, setTrans]  = useState("");
  const [transLoading, setTL]   = useState(false);
  const [time, setTime]         = useState(0);
  const [protocoloSel, setProtSel] = useState(null);
  const [tickIA, setTickIA]     = useState(0); // força a barra de uso a atualizar após cada análise
  const [comprandoIA, setComprandoIA] = useState(false);
  const comprarIA50 = async () => {
    setComprandoIA(true);
    try {
      LS.write("fp:compraPendente:" + clinicaId, { tipo: "ia50", qtd: 50, ts: Date.now() });
      const r = await fetch("/api/stripe", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          valorCentavos: 4990, descricao: "Pacote +50 análises de IA — FisioPiede",
          clinicaId: clinicaId || "", clinicaNome: clinicaName || "",
          origem: (typeof window !== "undefined" && window.location ? window.location.origin : "")
        }),
      });
      const d = await r.json();
      if (d.url) { window.location.href = d.url; }
      else { alert(d.error?.message || "Não foi possível abrir o pagamento. (Requer o site publicado.)"); setComprandoIA(false); }
    } catch (e) { alert("Não foi possível abrir o pagamento agora. Tente novamente."); setComprandoIA(false); }
  };

  useEffect(()=>{
    let iv; if(rec){iv=setInterval(()=>setTime(t=>t+1),1000);}
    return()=>{if(iv)clearInterval(iv);};
  },[rec]);
  const fmt=`${String(Math.floor(time/60)).padStart(2,"0")}:${String(time%60).padStart(2,"0")}`;

  // Quando seleciona patologia, carrega protocolo e pré-preenche
  useEffect(()=>{
    if(!patologia || !PROTOCOLOS_FP[patologia]) { setProtSel(null); return; }
    setProtSel(PROTOCOLOS_FP[patologia]);
  },[patologia]);

  // Constrói o prompt com contexto do protocolo FisioPiede
  function buildPrompt(pac, queixa, obs, prot) {
    const pacCtx = pac
      ? `Paciente: ${pacSel}. Peso: ${pac.peso||"?"}kg, Altura: ${pac.altura||"?"}cm, Numeração: ${pac.numeracao||"?"}. Atividade: ${pac.atividade||"?"}.`
      : "";

    const protCtx = prot ? `
PROTOCOLO FISIOPIEDE PARA ${patologia.toUpperCase()}:
- Definição: ${prot.definicao}
- Sintomas típicos: ${prot.sintomas}
- Tratamento recomendado: ${prot.tratamento}
- Elemento de palmilha indicado: ${prot.palmilha.elementos}
- Exercícios do protocolo: ${prot.exercicios.join("; ")}
- Indicações para casa: ${prot.indicacoesCasa}
- Sessões recomendadas: ${prot.fases.map(f=>f.nome+" ("+f.atendimentos+" atendimentos)").join(" | ")}

Use EXATAMENTE o protocolo acima como base. A prescrição da palmilha DEVE seguir o protocolo FisioPiede.` : "";

    return `Você é fisioterapeuta especialista em posturologia e órteses plantares da clínica FisioPiede.
${pacCtx}
${protCtx}

Queixa do paciente: ${queixa}
Observações clínicas: ${obs||"Nenhuma observação adicional."}

Analise o caso clinicamente e retorne SOMENTE um JSON válido (sem markdown, sem texto fora do JSON):
{"queixa":"resumo objetivo","posturo":"análise postural detalhada","biomecanica":"análise biomecânica","diagnostico":"hipótese diagnóstica","conduta":"conduta proposta seguindo protocolo FisioPiede","prescricao_palmilha":{"tipo":"Inteira","flexibilidade":"Normal","cobertura":"EVA Perfurado","espessura":"4mm","observacoes_direito":"especificações pé direito com elementos do protocolo","observacoes_esquerdo":"especificações pé esquerdo com elementos do protocolo"},"exercicios":["exercício 1 do protocolo","exercício 2","exercício 3","exercício 4"],"retorno":"prazo","urgencia":"eletivo"}`;
  }

  async function analisarComIA() {
    if(!queixaInput.trim()){ setErro("Descreva a queixa principal do paciente."); return; }
    const permIA = podeUsarIA(clinicaId, planoIA);
    if(!permIA.ok){ setErro(permIA.msg); return; }
    setTickIA(t=>t+1); // a barra de cota desce na hora
    setErro(""); setLoading(true); setResultIA(null);
    const pac = pacientes.find(p=>`${p.nome} ${p.sobrenome}`===pacSel)||null;
    const prompt = buildPrompt(pac, queixaInput, obsInput, protocoloSel);

    try {
      const res = await fetch("/api/ia",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          model:"claude-opus-4-7",
          max_tokens:1500,
          messages:[{role:"user",content:prompt}]
        })
      });
      if(!res.ok){ const e=await res.json().catch(()=>({})); throw new Error(e.error?.message||`HTTP ${res.status}`); }
      const data = await res.json();
      const text = (data.content||[]).map(b=>b.text||"").join("").trim();
      const match = text.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(match?match[0]:text);
      // Se tem protocolo, força prescrição do protocolo se a IA não detalhou
      if(protocoloSel && parsed.prescricao_palmilha){
        if(!parsed.prescricao_palmilha.observacoes_direito||parsed.prescricao_palmilha.observacoes_direito.length<10)
          parsed.prescricao_palmilha.observacoes_direito = protocoloSel.palmilha.observacoes_direito;
        if(!parsed.prescricao_palmilha.observacoes_esquerdo||parsed.prescricao_palmilha.observacoes_esquerdo.length<10)
          parsed.prescricao_palmilha.observacoes_esquerdo = protocoloSel.palmilha.observacoes_esquerdo;
      }
      setResultIA(parsed);
    } catch(e){
      console.error("IA error:",e);
      setErro(`Erro ao analisar. Verifique sua conexão e tente novamente. (${e.message})`);
    }
    setLoading(false);
  }

  // Modo demo com protocolo integrado
  function usarDemo(){
    const prot = protocoloSel || PROTOCOLOS_FP["Fascite Plantar"];
    setResultIA({
      queixa: "Dor plantar bilateral há 3 meses, intensidade 7/10, piora matinal. Pratica corrida 4x/semana.",
      posturo: "Anteriorização de cabeça discreta. Joelhos em valgo bilateral. Retroversão pélvica.",
      biomecanica: "Pronação excessiva bilateral (esq > dir). Retropé em valgo. Sobrecarga no retropé.",
      diagnostico: patologia || "Fascite Plantar — fase aguda com componente biomecânico.",
      conduta: prot.tratamento,
      prescricao_palmilha: {
        tipo: prot.palmilha.tipo,
        flexibilidade: prot.palmilha.flexibilidade,
        cobertura: prot.palmilha.cobertura,
        espessura: prot.palmilha.espessura,
        observacoes_direito: prot.palmilha.observacoes_direito,
        observacoes_esquerdo: prot.palmilha.observacoes_esquerdo,
      },
      exercicios: prot.exercicios.slice(0,5),
      retorno: `${prot.fases[0]?.atendimentos||6} sessões`,
      urgencia: "normal",
    });
    setErro("");
  }

  function gerarExerciciosPDF(){
    if(!resultIA || !Array.isArray(resultIA.exercicios) || !resultIA.exercicios.length){ alert("Gere uma avaliação com exercícios primeiro."); return; }
    const hoje = new Date().toLocaleDateString("pt-BR");
    const esc = (s)=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const itens = resultIA.exercicios.map((e,i)=>`<li><span class="num">${i+1}</span><span>${esc(e)}</span></li>`).join("");
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
      <title>Exercícios — ${esc(pacSel||"Paciente")}</title>
      <style>
        *{box-sizing:border-box;margin:0;padding:0;}
        body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0F172A;padding:40px 44px;font-size:14px;line-height:1.6;}
        .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #3B82F6;padding-bottom:16px;margin-bottom:24px;}
        .marca{font-size:25px;font-weight:800;color:#3B82F6;letter-spacing:-.5px;}
        .marca span{color:#0F172A;}
        .sub{font-size:11px;color:#64748B;margin-top:2px;letter-spacing:.04em;}
        .clin{text-align:right;font-size:12px;color:#334155;}
        .clin b{font-size:14px;color:#0F172A;}
        h1{font-size:17px;color:#1E293B;margin:0 0 4px;}
        .pac{font-size:13px;color:#475569;margin-bottom:20px;}
        ol{list-style:none;}
        ol li{display:flex;gap:12px;align-items:flex-start;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:13px 15px;margin-bottom:10px;}
        .num{flex:none;width:26px;height:26px;border-radius:50%;background:#3B82F6;color:#fff;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center;}
        .ass{margin-top:54px;display:flex;justify-content:center;}
        .ass div{text-align:center;border-top:1px solid #475569;padding-top:7px;width:320px;font-size:12px;color:#475569;}
        .foot{margin-top:30px;border-top:1px solid #E2E8F0;padding-top:13px;font-size:10px;color:#94A3B8;text-align:center;}
        @media print{body{padding:26px 30px;} button{display:none;}}
      </style></head><body>
      <div class="top">
        <div><div class="marca">Fisio<span>Piede</span></div><div class="sub">HEALTH TECH PLATFORM</div></div>
        <div class="clin"><b>${esc(clinicaName||"Clínica")}</b><br>Emitido em ${esc(hoje)}</div>
      </div>
      <h1>Plano de Exercícios</h1>
      <div class="pac">Paciente: <b>${esc(pacSel||"—")}</b></div>
      <ol>${itens}</ol>
      <div class="ass"><div>Fisioterapeuta responsável — ${esc(clinicaName||"")}</div></div>
      <div class="foot">FisioPiede Health Tech Platform • ${esc(hoje)} • Documento para acompanhamento do paciente.</div>
      <script>window.onload=function(){setTimeout(function(){window.print();},350);};<\/script>
      </body></html>`;
    const w = window.open("", "_blank");
    if(!w){ alert("Permita pop-ups/janelas para imprimir os exercícios."); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }

  function gerarLaudoPDF(){
    if(!resultIA) return;
    const pac = pacientes.find(p=>`${p.nome} ${p.sobrenome}`===pacSel) || {};
    const pr = resultIA.prescricao_palmilha || {};
    const hoje = new Date().toLocaleDateString("pt-BR");
    const esc = (s)=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const linha = (rotulo,valor)=> valor ? `<tr><td class="rot">${esc(rotulo)}</td><td>${esc(valor)}</td></tr>` : "";
    const bloco = (titulo,texto)=> texto ? `<div class="bloco"><div class="bt">${esc(titulo)}</div><div class="bx">${esc(texto)}</div></div>` : "";
    const exers = Array.isArray(resultIA.exercicios) && resultIA.exercicios.length
      ? `<div class="bloco"><div class="bt">Exercícios prescritos</div><ol class="ex">${resultIA.exercicios.map(e=>`<li>${esc(e)}</li>`).join("")}</ol></div>` : "";
    const palmilha = pr && (pr.tipo||pr.observacoes_direito||pr.observacoes_esquerdo) ? `
      <div class="bloco"><div class="bt">Prescrição da palmilha</div>
        <table class="tb">
          ${linha("Tipo", pr.tipo)}${linha("Flexibilidade", pr.flexibilidade)}
          ${linha("Cobertura", pr.cobertura)}${linha("Espessura", pr.espessura)}
        </table>
        <div class="pes">
          <div class="pe"><div class="pel">Pé direito</div><div>${esc(pr.observacoes_direito||"—")}</div></div>
          <div class="pe"><div class="pel">Pé esquerdo</div><div>${esc(pr.observacoes_esquerdo||"—")}</div></div>
        </div>
      </div>` : "";
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
      <title>Laudo FisioPiede — ${esc(pacSel||"Paciente")}</title>
      <style>
        *{box-sizing:border-box;margin:0;padding:0;}
        body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0F172A;padding:38px 42px;font-size:13px;line-height:1.6;}
        .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #3B82F6;padding-bottom:16px;margin-bottom:22px;}
        .marca{font-size:24px;font-weight:800;color:#3B82F6;letter-spacing:-.5px;}
        .marca span{color:#0F172A;}
        .sub{font-size:11px;color:#64748B;margin-top:2px;}
        .clin{text-align:right;font-size:12px;color:#334155;}
        .clin b{font-size:14px;color:#0F172A;}
        h1{font-size:15px;color:#1E293B;margin:0 0 14px;text-transform:uppercase;letter-spacing:.5px;}
        .tb{width:100%;border-collapse:collapse;margin:4px 0 2px;}
        .tb td{padding:5px 8px;border-bottom:1px solid #E2E8F0;vertical-align:top;}
        .tb .rot{font-weight:700;color:#475569;width:130px;}
        .bloco{margin:16px 0;}
        .bt{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;color:#3B82F6;border-left:3px solid #3B82F6;padding-left:9px;margin-bottom:7px;}
        .bx{color:#1E293B;padding-left:12px;}
        .ex{padding-left:30px;color:#1E293B;} .ex li{margin-bottom:4px;}
        .pes{display:flex;gap:14px;margin-top:10px;}
        .pe{flex:1;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:11px 13px;}
        .pel{font-size:10px;font-weight:800;text-transform:uppercase;color:#64748B;margin-bottom:5px;}
        .diag{background:#EFF6FF;border:1px solid #BFDBFE;border-radius:9px;padding:12px 15px;margin-bottom:6px;}
        .diag .dl{font-size:10px;font-weight:800;text-transform:uppercase;color:#3B82F6;}
        .diag .dv{font-size:15px;font-weight:800;color:#0F172A;}
        .foot{margin-top:34px;border-top:1px solid #E2E8F0;padding-top:14px;font-size:10px;color:#94A3B8;text-align:center;}
        .ass{margin-top:46px;display:flex;justify-content:center;}
        .ass div{text-align:center;border-top:1px solid #475569;padding-top:6px;width:280px;font-size:11px;color:#475569;}
        @media print{body{padding:24px 28px;} button{display:none;}}
      </style></head><body>
      <div class="top">
        <div><div class="marca">Fisio<span>Piede</span></div><div class="sub">Sistema de Palmilhas Posturais 3D</div></div>
        <div class="clin"><b>${esc(clinicaName||"Clínica")}</b><br>Emitido em ${esc(hoje)}</div>
      </div>
      <h1>Laudo de Avaliação e Prescrição</h1>
      <table class="tb">
        ${linha("Paciente", pacSel||"—")}
        ${linha("Peso", pac.peso?pac.peso+" kg":"")}
        ${linha("Altura", pac.altura?pac.altura+" cm":"")}
        ${linha("Numeração", pac.numeracao)}
        ${linha("Atividade", pac.atividade)}
        ${linha("Patologia", patologia)}
      </table>
      ${resultIA.diagnostico?`<div class="bloco"><div class="diag"><div class="dl">Hipótese diagnóstica</div><div class="dv">${esc(resultIA.diagnostico)}</div></div></div>`:""}
      ${bloco("Queixa", resultIA.queixa)}
      ${bloco("Análise postural", resultIA.posturo)}
      ${bloco("Análise biomecânica", resultIA.biomecanica)}
      ${bloco("Conduta proposta", resultIA.conduta)}
      ${palmilha}
      ${exers}
      ${bloco("Retorno sugerido", resultIA.retorno)}
      <div class="ass"><div>Responsável Técnico — ${esc(clinicaName||"")}</div></div>
      <div class="foot">Documento gerado pelo sistema FisioPiede • ${esc(hoje)} • Este laudo deve ser validado e assinado pelo profissional responsável.</div>
      <script>window.onload=function(){setTimeout(function(){window.print();},350);};<\/script>
      </body></html>`;
    const w = window.open("", "_blank");
    if(!w){ alert("Permita pop-ups/janelas para gerar o laudo em PDF."); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }

  function gerarPedidoComIA(){
    if(!resultIA?.prescricao_palmilha) return;
    const pac=pacientes.find(p=>`${p.nome} ${p.sobrenome}`===pacSel)||{};
    const t=nowTs(); const id=`#${6500+Math.floor(Math.random()*500)}`;
    const pr=resultIA.prescricao_palmilha;
    setPedidos(prev=>[{
      id,clinicaId:clinicaId||pac.clinicaId||1,
      clinica:clinicaName||pac.clinica||"—",
      paciente:pacSel||"Paciente IA",pacienteId:pac.id||null,
      tipo:patologia||"Palmilha IA",tipoPalmilha:pr.tipo||"Inteira",
      tipoCalcado:"Tênis",flexibilidade:pr.flexibilidade||"Normal",
      cobertura:pr.cobertura||"EVA Perfurado",cor:"Preto",espessura:pr.espessura||"4mm",
      comprimento:"",larguraAntePe:"",larguraCalcaneo:"",
      numeracao:pac.numeracao||"",peso:pac.peso||"",altura:pac.altura||"",
      obsDireito:pr.observacoes_direito||"",obsEsquerdo:pr.observacoes_esquerdo||"",
      obs:`${patologia?patologia+". ":""}${resultIA.diagnostico||""}`,
      status:"Recebido",rastreio:"",
      updatedAt:t,data:new Date().toISOString().split("T")[0],
      log:[`${t} — Recebido (protocolo IA: ${patologia||"geral"})`],
      arquivos:{direito:[],esquerdo:[]},
    },...prev]);
    setSalvo(true); setTimeout(()=>setSalvo(false),3000);
  }

  // Transcrição de voz REAL via Web Speech API (nativo do navegador)
  const recognitionRef = useRef(null);
  const ehIOS = useState(()=>typeof navigator!=="undefined" && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1)))[0];
  const [speechSupported] = useState(()=>typeof window!=="undefined" && (window.SpeechRecognition||window.webkitSpeechRecognition) && !(/iPad|iPhone|iPod/.test(navigator.userAgent)));

  // ── Gravação de áudio (consulta) → transcrição pelo Whisper (OpenAI) ──
  const mediaRecRef = useRef(null);
  const chunksRef = useRef([]);
  const audioTimerRef = useRef(null);
  const audioStopTimerRef = useRef(null);
  const segmentosRef = useRef([]);     // fatias de áudio já fechadas (consulta longa)
  const streamRef = useRef(null);      // microfone aberto durante a consulta
  const encerrandoRef = useRef(false); // true quando o usuário clicou em Parar
  const fatiaTimerRef = useRef(null);  // troca de fatia a cada 4 min
  const jaTranscreveuRef = useRef(false); // garante UMA transcrição (e uma cobrança) por gravação
  const [gravandoAudio, setGravandoAudio] = useState(false);
  const [transcrevendoAudio, setTranscrevendoAudio] = useState(false);
  const [tempoAudio, setTempoAudio] = useState(0);
  const [erroAudio, setErroAudio] = useState("");
  const [msgConsulta, setMsgConsulta] = useState("");
  const [transConsulta, setTransConsulta] = useState("");   // transcrição bruta completa
  const [notaConsulta, setNotaConsulta] = useState(null);   // prontuário estruturado EDITÁVEL
  const [estruturando, setEstruturando] = useState(false);
  const [pacConsulta, setPacConsulta] = useState("");
  const [salvoConsulta, setSalvoConsulta] = useState(false);
  const [editandoNotaId, setEditandoNotaId] = useState(null);
  const [mostrarBruta, setMostrarBruta] = useState(false);
  const [micStatus, setMicStatus] = useState(null); // null | "ok" | "negado" | "semMic" | "erro"
  const [testandoMic, setTestandoMic] = useState(false);
  const [salvandoNota, setSalvandoNota] = useState(false);
  const SEG_SEG = 240;            // cada fatia tem ~4 min (tamanho que a transcrição aceita)
  const MAX_MIN_CONSULTA = 60;    // consulta inteira: até 1 hora

  // 🎤 Pede a permissão do microfone na hora e informa o resultado em português claro
  async function testarMicrofone(){
    setTestandoMic(true); setMicStatus(null);
    try{
      if(typeof navigator==="undefined" || !navigator.mediaDevices){ setMicStatus("erro"); setTestandoMic(false); return; }
      const st = await navigator.mediaDevices.getUserMedia({ audio:true });
      try{ st.getTracks().forEach(t=>t.stop()); }catch(e){}
      setMicStatus("ok");
    }catch(e){
      if(e && (e.name==="NotAllowedError"||e.name==="PermissionDeniedError")) setMicStatus("negado");
      else if(e && (e.name==="NotFoundError"||e.name==="DevicesNotFoundError")) setMicStatus("semMic");
      else setMicStatus("erro");
    }
    setTestandoMic(false);
  }

  // Abre uma nova fatia de gravação no mesmo microfone. Cada fatia fechada vira
  // um arquivo pequeno e independente — é isso que permite gravar a consulta INTEIRA.
  function novaFatia(){
    const stream = streamRef.current; if(!stream) return;
    const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
    let mr;
    try { mr = mime ? new MediaRecorder(stream,{mimeType:mime,audioBitsPerSecond:48000}) : new MediaRecorder(stream,{audioBitsPerSecond:48000}); }
    catch(e){ mr = mime ? new MediaRecorder(stream,{mimeType:mime}) : new MediaRecorder(stream); }
    chunksRef.current = [];
    mr.ondataavailable = (e)=>{ if(e.data && e.data.size>0) chunksRef.current.push(e.data); };
    mr.onstop = ()=>{
      const blob = new Blob(chunksRef.current, { type:"audio/webm" });
      if(blob.size>0) segmentosRef.current.push(blob);
      if(encerrandoRef.current){
        try{ stream.getTracks().forEach(t=>t.stop()); }catch(e){}
        streamRef.current = null;
        transcreverConsulta();
      } else {
        novaFatia(); // continua gravando sem pausa perceptível
      }
    };
    mediaRecRef.current = mr;
    mr.start();
  }

  async function iniciarAudioConsulta(){
    setErroAudio("");
    if(typeof navigator==="undefined" || !navigator.mediaDevices || !window.MediaRecorder){
      setErroAudio("Seu navegador não suporta gravação de áudio. Use Chrome ou Edge no computador."); return;
    }
    try{
      const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
      streamRef.current = stream;
      segmentosRef.current = [];
      encerrandoRef.current = false;
      jaTranscreveuRef.current = false;
      novaFatia();
      setGravandoAudio(true); setTempoAudio(0); setMsgConsulta("");
      setNotaConsulta(null); setTransConsulta(""); setSalvoConsulta(false); setEditandoNotaId(null); setMostrarBruta(false);
      audioTimerRef.current = setInterval(()=>setTempoAudio(t=>t+1), 1000);
      // troca de fatia a cada ~4 min (sem interromper a consulta)
      fatiaTimerRef.current = setInterval(()=>{ try{ if(mediaRecRef.current && mediaRecRef.current.state!=="inactive") mediaRecRef.current.stop(); }catch(e){} }, SEG_SEG*1000);
      // teto de segurança: 60 minutos
      audioStopTimerRef.current = setTimeout(()=>{ setErroAudio("Limite de 60 minutos atingido — transcrevendo a consulta gravada."); pararAudioConsulta(); }, MAX_MIN_CONSULTA*60*1000);
    }catch(e){
      if(e && (e.name==="NotAllowedError"||e.name==="PermissionDeniedError")){ setMicStatus("negado"); setErroAudio("O navegador bloqueou o microfone. Clique no cadeado 🔒 ao lado do endereço → Microfone → Permitir → recarregue a página."); }
      else setErroAudio("Não foi possível iniciar a gravação de áudio.");
    }
  }

  function pararAudioConsulta(){
    if(audioTimerRef.current){ clearInterval(audioTimerRef.current); audioTimerRef.current=null; }
    if(fatiaTimerRef.current){ clearInterval(fatiaTimerRef.current); fatiaTimerRef.current=null; }
    if(audioStopTimerRef.current){ clearTimeout(audioStopTimerRef.current); audioStopTimerRef.current=null; }
    setGravandoAudio(false);
    setMsgConsulta("Fechando a gravação..."); // feedback IMEDIATO — nunca mais "não aconteceu nada"
    encerrandoRef.current = true; // a última fatia fecha e dispara a transcrição completa
    let parou = false;
    if(mediaRecRef.current && mediaRecRef.current.state!=="inactive"){ try{ mediaRecRef.current.stop(); parou = true; }catch(_){} }
    // 🛟 Rede de segurança 1: gravador já morto/sem stop → transcreve direto o que existe
    if(!parou){
      try{ if(streamRef.current){ streamRef.current.getTracks().forEach(t=>t.stop()); streamRef.current=null; } }catch(_){}
      transcreverConsulta();
    }
    // 🛟 Rede de segurança 2: vigia — se em 2,5s nada disparou, força a transcrição
    setTimeout(()=>{ if(!jaTranscreveuRef.current){ try{ if(streamRef.current){ streamRef.current.getTracks().forEach(t=>t.stop()); streamRef.current=null; } }catch(_){} transcreverConsulta(); } }, 2500);
  }

  // Transcreve TODAS as fatias da consulta, em ordem, e monta o texto completo
  async function transcreverConsulta(){
    if(jaTranscreveuRef.current) return; // roda (e cobra) UMA vez só por gravação
    jaTranscreveuRef.current = true;
    // recolhe pedaços que ficaram soltos se o onstop não rodou
    try{
      if(chunksRef.current && chunksRef.current.length>0 && (segmentosRef.current||[]).length===0){
        const b = new Blob(chunksRef.current, { type:"audio/webm" });
        if(b.size>0) segmentosRef.current = [b];
        chunksRef.current = [];
      }
    }catch(e){}
    const segs = segmentosRef.current || [];
    if(segs.length===0){ setMsgConsulta(""); setErroAudio("Nenhum áudio foi capturado. Verifique se o microfone está liberado para o site (cadeado 🔒 na barra de endereço → Microfone → Permitir) e tente de novo."); return; }
    const permIA = podeUsarIAqtd(clinicaId, planoIA, 20); // consulta inteira consome 20 análises
    if(!permIA.ok){ setErroAudio(permIA.msg); return; }
    setTickIA(t=>t+1);
    setTranscrevendoAudio(true); setErroAudio("");
    try{
      let texto = "";
      for(let i=0;i<segs.length;i++){
        setMsgConsulta(`Transcrevendo a consulta... parte ${i+1} de ${segs.length}`);
        if(segs[i].size/(1024*1024) > 4.2){ setErroAudio(`Uma parte do áudio ficou pesada demais e foi pulada (${(segs[i].size/1024/1024).toFixed(1)}MB). O restante foi transcrito normalmente.`); continue; }
        const base64 = await new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=()=>resolve(String(r.result).split(",")[1]); r.onerror=()=>reject(new Error("falha ao ler áudio")); r.readAsDataURL(segs[i]); });
        const res = await fetch("/api/transcrever",{ method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ audioBase64:base64, mime:"audio/webm", filename:`consulta-parte${i+1}.webm` }) });
        const data = await res.json();
        if(!res.ok) throw new Error((data&&data.error&&data.error.message)||("Erro "+res.status));
        texto = (texto+" "+(data.text||"")).trim();
        setTransConsulta(texto);
      }
      setMsgConsulta("");
      if(!texto){ setErroAudio("A transcrição voltou vazia. Tente falar mais perto do microfone."); }
      else { await estruturarConsulta(texto); }
    }catch(e){
      setMsgConsulta("");
      setErroAudio("Não foi possível transcrever: "+((e&&e.message)||"erro")+". (Requer o sistema publicado e a chave OPENAI_API_KEY configurada.)");
    }
    setTranscrevendoAudio(false);
  }

  // 🧠 Organiza a transcrição num prontuário clínico: SÓ o que importa, sem conversa fiada
  async function estruturarConsulta(texto){
    setEstruturando(true);
    try{
      const res = await fetch("/api/ia",{ method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          model:"claude-opus-4-7", max_tokens:1400,
          messages:[{role:"user",content:[{type:"text",text:`Você é o escriba clínico da FisioPiede. Abaixo está a transcrição bruta de uma consulta de fisioterapia. Extraia APENAS as informações clinicamente relevantes ditas na consulta, em português formal de prontuário. REGRAS: nunca invente nada que não foi dito; ignore piadas, conversas paralelas e assuntos pessoais sem valor clínico; se uma seção não foi abordada, devolva "" nela. Responda SOMENTE um JSON válido (sem markdown): {"queixa":"queixa principal e duração","historia":"história clínica relevante (antecedentes, medicações, cirurgias, hábitos, atividade física)","exame":"achados do exame físico e da avaliação citados","avaliacao":"hipótese/raciocínio clínico citado","conduta":"conduta, tratamento e prescrições definidas (incluindo palmilha, se citada)","orientacoes":"orientações e exercícios passados ao paciente","retorno":"retorno e encaminhamentos combinados"}. TRANSCRIÇÃO DA CONSULTA: ${texto}`}]}],
        }),
      });
      const data = await res.json();
      if(!res.ok) throw new Error("falha");
      const txt = (data.content||[]).map(i=>i.text||"").join("").replace(/```json|```/g,"").trim();
      const j = JSON.parse(txt);
      setNotaConsulta({ queixa:j.queixa||"", historia:j.historia||"", exame:j.exame||"", avaliacao:j.avaliacao||"", conduta:j.conduta||"", orientacoes:j.orientacoes||"", retorno:j.retorno||"" });
    }catch(e){
      setErroAudio("Transcrevi a consulta, mas não consegui organizar o prontuário agora. O texto bruto está disponível abaixo — você pode preencher as seções manualmente e salvar.");
      setNotaConsulta({ queixa:"", historia:"", exame:"", avaliacao:"", conduta:"", orientacoes:"", retorno:"" });
    }
    setEstruturando(false);
  }

  // 🧾 Documento do laudo da consulta (impressão e cópia na nuvem)
  const montarLaudoConsultaHTML = (secoes, dataLaudo, nomePac, autoPrint) => {
    const esc = (t) => String(t==null?"":t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const ROTULOS = [["queixa","Queixa principal"],["historia","História clínica"],["exame","Exame físico / Avaliação"],["avaliacao","Hipótese clínica"],["conduta","Conduta e prescrição"],["orientacoes","Orientações e exercícios"],["retorno","Retorno / Encaminhamentos"]];
    const blocos = ROTULOS.filter(([k])=>secoes&&String(secoes[k]||"").trim()).map(([k,r])=>`<div class="sec"><div class="sec-t">${esc(r)}</div><div class="sec-c">${esc(secoes[k]).replace(/\n/g,"<br/>")}</div></div>`).join("");
    const dataBr = dataLaudo ? dataLaudo.split("-").reverse().join("/") : "";
    return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"/><title>Registro de Consulta — FisioPiede</title><style>
      *{margin:0;padding:0;box-sizing:border-box;} body{font-family:Georgia,'Times New Roman',serif;color:#1a2333;background:#fff;padding:42px 48px;}
      .topo{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #F59E0B;padding-bottom:14px;margin-bottom:24px;}
      .marca{font-family:Arial,Helvetica,sans-serif;font-weight:800;font-size:22px;color:#0f1729;} .marca span{color:#F59E0B;}
      .sub{font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;color:#6b7689;text-transform:uppercase;margin-top:2px;}
      .meta{text-align:right;font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:#3d4a61;line-height:1.7;}
      h1{font-family:Arial,Helvetica,sans-serif;font-size:16px;color:#0f1729;margin-bottom:18px;}
      .sec{margin-bottom:16px;page-break-inside:avoid;}
      .sec-t{font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#8B5CF6;border-bottom:1px solid #e3e7ef;padding-bottom:4px;margin-bottom:7px;}
      .sec-c{font-size:13px;line-height:1.75;color:#222d42;white-space:pre-wrap;}
      .rodape{margin-top:34px;border-top:1px solid #e3e7ef;padding-top:12px;font-family:Arial,Helvetica,sans-serif;font-size:9.5px;color:#8a93a6;line-height:1.7;}
      @media print{ body{padding:24px 28px;} }
    </style></head><body>
      <div class="topo">
        <div><div class="marca">Fisio<span>Piede</span></div><div class="sub">Health Tech Platform</div></div>
        <div class="meta"><strong>Paciente:</strong> ${esc(nomePac||"—")}<br/><strong>Data da consulta:</strong> ${esc(dataBr)}<br/><strong>Clínica:</strong> ${esc(clinicaName||"FisioPiede")}</div>
      </div>
      <h1>Registro de Consulta Fisioterapêutica</h1>
      ${blocos || '<div class="sec-c">—</div>'}
      <div class="rodape">Documento gerado pela plataforma FisioPiede como registro de apoio da consulta, revisado pelo profissional responsável. As informações aqui contidas não substituem avaliação presencial. Tratado conforme a LGPD.</div>
      ${autoPrint ? `<script>window.onload=function(){setTimeout(function(){window.print();},350);};<\/script>` : ""}</body></html>`;
  };

  // 🖨️ Abre o laudo da consulta pronto para imprimir/salvar em PDF
  const imprimirLaudoConsulta = () => {
    if(!notaConsulta) return;
    const html = montarLaudoConsultaHTML(notaConsulta, new Date().toISOString().split("T")[0], pacConsulta, true);
    const w = window.open("", "_blank"); if(!w){ alert("Permita pop-ups para gerar o laudo."); return; }
    w.document.open(); w.document.write(html); w.document.close();
  };

  // 💾 Salva (ou atualiza) a nota no prontuário + guarda o laudo na nuvem
  const salvarProntuario = async () => {
    if(!pacConsulta){ setErroAudio("Selecione o paciente para salvar o prontuário."); return; }
    if(!notaConsulta) return;
    setErroAudio(""); setSalvandoNota(true);
    // ☁️ Laudo formatado vai para a nuvem (link permanente). Se falhar, salva sem o link.
    let laudoUrl = null;
    const dataHoje = new Date().toISOString().split("T")[0];
    try {
      const html = montarLaudoConsultaHTML(notaConsulta, dataHoje, pacConsulta, false);
      const arq = new File([html], `laudo-consulta-${Date.now()}.html`, { type:"text/html" });
      laudoUrl = await STORAGE_FP.upload(arq, "laudos");
    } catch(e) {}
    setPacientes(prev => prev.map(p => {
      if(`${p.nome} ${p.sobrenome||""}`.trim() !== pacConsulta) return p;
      const lista = [...(p.prontuarios||[])];
      if(editandoNotaId){
        const ix = lista.findIndex(n=>n.id===editandoNotaId);
        if(ix>=0) lista[ix] = { ...lista[ix], secoes:notaConsulta, transcricao: transConsulta || lista[ix].transcricao, laudoUrl: laudoUrl || lista[ix].laudoUrl, editadoEm: new Date().toISOString() };
      } else {
        lista.push({ id:"NOTA-"+Date.now().toString(36), data:dataHoje, secoes:notaConsulta, transcricao:transConsulta, laudoUrl });
      }
      return { ...p, prontuarios: lista };
    }));
    setSalvandoNota(false);
    setSalvoConsulta(true);
  };

  // Reabre uma nota do histórico para edição
  const abrirNota = (n) => {
    setNotaConsulta({ ...(n.secoes||{}) });
    setTransConsulta(n.transcricao||"");
    setEditandoNotaId(n.id);
    setSalvoConsulta(false); setMostrarBruta(false); setErroAudio("");
  };
  const fmtAudio = `${String(Math.floor(tempoAudio/60)).padStart(2,"0")}:${String(tempoAudio%60).padStart(2,"0")}`;

  function iniciarGravacao(){
    if(!speechSupported){ setErro("Seu navegador não suporta reconhecimento de voz. Use Chrome ou Edge."); return; }
    const SR = window.SpeechRecognition||window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = "pt-BR";
    rec.continuous = true;
    rec.interimResults = true;
    let finalText = "";
    rec.onresult = (e)=>{
      let interim = "";
      for(let i=e.resultIndex;i<e.results.length;i++){
        const t = e.results[i][0].transcript;
        if(e.results[i].isFinal) finalText += t + " ";
        else interim += t;
      }
      setTrans(finalText + interim);
    };
    rec.onerror = (e)=>{ console.error("Speech error:",e.error); if(e.error==="not-allowed") setErro("Permita o acesso ao microfone para gravar."); };
    rec.onend = ()=>{ if(recognitionRef.current?.active){ try{rec.start();}catch(_){} } };
    recognitionRef.current = rec; rec.active = true;
    try{ rec.start(); setRec(true); setTime(0); setTrans(""); setErro(""); }
    catch(e){ setErro("Não foi possível iniciar a gravação."); }
  }

  function transcrever(){
    setRec(false);
    if(recognitionRef.current){ recognitionRef.current.active=false; try{recognitionRef.current.stop();}catch(_){} }
  }
  function salvarNoProntuario(){ if(!resultIA) return; setSalvo(true); setTimeout(()=>setSalvo(false),3000); }

  const urgCor = u=>u==="urgente"?C.red:u==="normal"?C.amber:C.green;
  const ABAS=[{id:"avaliacao",icon:"✦",label:"Avaliação com IA"},{id:"baropodometria",icon:"👣",label:"Baropodometria IA"},{id:"protocolos",icon:"📋",label:"Protocolos FisioPiede"},{id:"transcricao",icon:"🎙️",label:"Transcrição"}];

  return(
    <div style={{padding:20}}>
      <SH title="Inteligência Artificial Clínica ✦" sub="Análise clínica baseada nos Protocolos FisioPiede"/>
      {planoIA && planoIA !== "admin" && (() => {
        const extra = creditoExtraIA(clinicaId);
        const limite = (IA_LIMITE[planoIA] !== undefined ? IA_LIMITE[planoIA] : 0) + extra;
        const usado = IA_USO.atual(clinicaId); void tickIA; // tickIA força a releitura após cada análise
        const rest = Math.max(0, limite - usado);
        const cor = rest === 0 ? C.red : rest <= 3 ? C.amber : C.green;
        return (
          <div style={{ marginBottom:14 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 14px", background:`${cor}10`, border:`1px solid ${cor}30`, borderRadius:8, fontSize:12 }}>
              <span>✦</span>
              <span style={{ color:C.sub }}>Análises de IA: <strong style={{ color:cor }}>{usado}/{limite}</strong> usadas · <strong style={{ color:cor }}>{rest}</strong> restantes{extra>0&&<span style={{color:C.muted}}> (inclui {extra} extra)</span>}</span>
            </div>
            {rest === 0 && (
              <div style={{ marginTop:8, padding:"12px 14px", background:`${C.accent}0A`, border:`1px solid ${C.accent}30`, borderRadius:9, display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
                <span style={{ fontSize:12, color:C.sub }}>Suas análises acabaram. Compre um pacote extra para continuar usando a IA agora.</span>
                <Btn v="primary" sz="sm" disabled={comprandoIA} onClick={comprarIA50}>{comprandoIA?"Abrindo...":"✦ Comprar +50 análises (R$ 49,90)"}</Btn>
              </div>
            )}
          </div>
        );
      })()}
      <div style={{display:"flex",borderBottom:`1px solid ${C.border}`,marginBottom:20}}>
        {ABAS.map(a=>{const at=aba===a.id;return(
          <button key={a.id} onClick={()=>setAba(a.id)} style={{padding:"10px 20px",fontSize:13,fontWeight:at?700:500,color:at?C.accent:C.muted,background:"none",borderBottom:at?`2px solid ${C.accent}`:"2px solid transparent",display:"flex",alignItems:"center",gap:6,transition:"all .15s",whiteSpace:"nowrap"}}>
            <span>{a.icon}</span>{a.label}
          </button>
        );})}
      </div>

      {/* ─── AVALIAÇÃO COM IA ────────────────────────────────── */}
      {aba==="avaliacao"&&(
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          <Card p={20} style={{background:`linear-gradient(135deg,${C.accent}06,${C.purple}04)`,border:`1px solid ${C.accent}18`}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:8}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:36,height:36,borderRadius:10,background:`linear-gradient(135deg,${C.accent},${C.purple})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>✦</div>
                <div>
                  <div style={{fontWeight:800,fontSize:15}}>Análise Clínica com IA</div>
                  <div style={{fontSize:12,color:C.muted}}>Selecione a patologia para usar o Protocolo FisioPiede automaticamente</div>
                </div>
              </div>

            </div>

            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              {/* Patologia — chave para ativar protocolo */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div>
                  <label>Patologia / Protocolo FisioPiede</label>
                  <select value={patologia} onChange={e=>setPatologia(e.target.value)} style={{borderColor:patologia?C.accent:undefined}}>
                    <option value="">— Selecione a patologia —</option>
                    {Object.keys(PROTOCOLOS_FP).map(k=>(
                      <option key={k} value={k}>{PROTOCOLOS_FP[k].icon} {k}</option>
                    ))}
                    <option value="outro">Outro / Avaliação geral</option>
                  </select>
                </div>
                <div>
                  <label>Paciente</label>
                  <select value={pacSel} onChange={e=>setPacSel(e.target.value)}>
                    <option value="">— Selecione (opcional) —</option>
                    {pacientes.map(p=><option key={p.id}>{p.nome} {p.sobrenome}</option>)}
                  </select>
                </div>
              </div>

              {/* Banner do protocolo selecionado */}
              {protocoloSel&&(
                <div style={{padding:"12px 14px",background:`${protocoloSel.cor}10`,border:`1px solid ${protocoloSel.cor}30`,borderRadius:10}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                    <span style={{fontSize:18}}>{protocoloSel.icon}</span>
                    <span style={{fontWeight:800,color:protocoloSel.cor,fontSize:13}}>Protocolo FisioPiede: {patologia}</span>
                    <Badge label={`${protocoloSel.fases[0]?.atendimentos} sessões`} color={protocoloSel.cor}/>
                  </div>
                  <div style={{fontSize:11,color:C.sub,lineHeight:1.6}}>{protocoloSel.sintomas}</div>
                  <div style={{marginTop:6,fontSize:11,color:protocoloSel.cor,fontWeight:700}}>
                    🦶 Palmilha: {protocoloSel.palmilha.elementos}
                  </div>
                </div>
              )}

              <div>
                <label>Queixa principal e sintomas *</label>
                <textarea rows={4} value={queixaInput} onChange={e=>setQ(e.target.value)} placeholder="Descreva os sintomas, há quanto tempo, intensidade, o que piora e o que melhora..."/>
              </div>
              <div>
                <label>Observações clínicas adicionais</label>
                <textarea rows={2} value={obsInput} onChange={e=>setObs(e.target.value)} placeholder="Exame físico, baropodometria, alterações biomecânicas observadas..."/>
              </div>

              {erro&&<div style={{padding:"10px 13px",background:`${C.red}10`,border:`1px solid ${C.red}28`,borderRadius:8,fontSize:12,color:C.red}}>⚠️ {erro}</div>}

              <Btn v="primary" onClick={analisarComIA} disabled={loading||!queixaInput.trim()} sz="lg" full>
                {loading
                  ?<><Spin sz={16}/> {patologia?`Analisando protocolo de ${patologia}...`:"Analisando com IA..."}</>
                  : patologia
                    ?`✦ Analisar com IA — Protocolo ${patologia}`
                    :"✦ Analisar com Inteligência Artificial"
                }
              </Btn>
            </div>
          </Card>

          {loading&&(
            <Card p={24} style={{textAlign:"center"}}>
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:14}}>
                <div style={{width:56,height:56,borderRadius:"50%",background:`linear-gradient(135deg,${C.accent},${C.purple})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,animation:"float 2s ease-in-out infinite"}}>✦</div>
                <div style={{fontWeight:700}}>IA analisando com Protocolo FisioPiede{patologia?` — ${patologia}`:""}...</div>
                <div style={{fontSize:12,color:C.muted}}>Gerando avaliação, diagnóstico e prescrição baseada nos seus protocolos clínicos</div>
                <div style={{display:"flex",gap:5,flexWrap:"wrap",justifyContent:"center"}}>
                  {["Protocolo","Diagnóstico","Prescrição","Exercícios"].map((s,i)=>(
                    <span key={i} style={{padding:"4px 10px",background:`${C.accent}12`,border:`1px solid ${C.accent}25`,borderRadius:99,fontSize:10,color:C.accent,animation:`pulse 1.5s ${i*.2}s ease-in-out infinite`}}>{s}</span>
                  ))}
                </div>
              </div>
            </Card>
          )}

          {resultIA&&!loading&&(
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  <Badge label="✦ Análise IA" color={C.accent}/>
                  {patologia&&<Badge label={`Protocolo: ${patologia}`} color={protocoloSel?.cor||C.purple}/>}
                  {resultIA.urgencia&&<Badge label={resultIA.urgencia.toUpperCase()} color={urgCor(resultIA.urgencia)}/>}
                </div>
                <div style={{display:"flex",gap:8}}>
                  {pacSel&&<Btn v="outline" sz="sm" onClick={salvarNoProntuario}>📋 Prontuário</Btn>}
                  <Btn v="outline" sz="sm" onClick={gerarLaudoPDF}>📄 Laudo PDF</Btn>
                  {Array.isArray(resultIA.exercicios)&&resultIA.exercicios.length>0&&<Btn v="outline" sz="sm" onClick={gerarExerciciosPDF}>🏃 Imprimir Exercícios</Btn>}
                  {resultIA.prescricao_palmilha&&<Btn v="primary" sz="sm" onClick={gerarPedidoComIA}>📦 Gerar Pedido</Btn>}
                </div>
              </div>
              {salvo&&<div style={{padding:"9px 13px",background:`${C.green}10`,border:`1px solid ${C.green}28`,borderRadius:8,fontSize:12,color:C.green,fontWeight:700}}>✓ Salvo com sucesso!</div>}
              {resultIA.diagnostico&&<div style={{padding:"12px 16px",background:`${C.purple}07`,border:`1px solid ${C.purple}25`,borderRadius:10}}><span style={{fontSize:10,color:C.purple,fontWeight:700,textTransform:"uppercase"}}>🔬 Diagnóstico — </span><span style={{fontSize:13,fontWeight:800}}>{resultIA.diagnostico}</span></div>}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                {[["🗣️ Queixa",resultIA.queixa,C.accent],["🧍 Posturologia",resultIA.posturo,C.purple],["⚙️ Biomecânica",resultIA.biomecanica,C.amber],["💡 Conduta",resultIA.conduta,C.green]].map(([t,v,c])=>v&&(
                  <Card key={t} p={14}><div style={{fontSize:10,color:c,fontWeight:700,textTransform:"uppercase",marginBottom:6}}>{t}</div><div style={{fontSize:12,color:C.sub,lineHeight:1.7}}>{v}</div></Card>
                ))}
              </div>
              {resultIA.prescricao_palmilha&&(
                <Card p={16} style={{background:`${C.green}06`,border:`1px solid ${C.green}22`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                    <div style={{fontSize:10,color:C.green,fontWeight:700,textTransform:"uppercase"}}>🦶 Prescrição de Palmilha {protocoloSel?"— Protocolo FisioPiede":""}</div>
                    {protocoloSel&&<Badge label={protocoloSel.palmilha.elementos.split("+")[0].trim()} color={C.green}/>}
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
                    {[["Tipo",resultIA.prescricao_palmilha.tipo],["Flexibilidade",resultIA.prescricao_palmilha.flexibilidade],["Cobertura",resultIA.prescricao_palmilha.cobertura],["Espessura",resultIA.prescricao_palmilha.espessura]].map(([l,v])=>(
                      <div key={l} style={{padding:"8px 10px",background:C.bgGlass,borderRadius:8,border:`1px solid ${C.border}`}}>
                        <div style={{fontSize:9,color:C.muted,fontWeight:700,textTransform:"uppercase",marginBottom:2}}>{l}</div>
                        <div style={{fontSize:12,fontWeight:700}}>{v||"—"}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    {[["🦵 Pé Direito",resultIA.prescricao_palmilha.observacoes_direito],["🦵 Pé Esquerdo",resultIA.prescricao_palmilha.observacoes_esquerdo]].map(([l,v])=>(
                      <div key={l} style={{padding:"10px 12px",background:`${C.accent}06`,border:`1px solid ${C.accent}18`,borderRadius:9}}>
                        <div style={{fontSize:9,color:C.accent,fontWeight:700,textTransform:"uppercase",marginBottom:4}}>{l}</div>
                        <div style={{fontSize:12,color:C.sub,lineHeight:1.6}}>{v||"Sem especificações adicionais."}</div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
              {resultIA.exercicios?.length>0&&(
                <Card p={16}>
                  <div style={{fontSize:10,color:C.amber,fontWeight:700,textTransform:"uppercase",marginBottom:10}}>💪 Exercícios {protocoloSel?"do Protocolo FisioPiede":"Recomendados"}</div>
                  {resultIA.exercicios.map((ex,i)=>(
                    <div key={i} style={{display:"flex",gap:10,padding:"8px 12px",background:C.bgGlass,borderRadius:8,border:`1px solid ${C.border}`,marginBottom:6}}>
                      <div style={{width:20,height:20,borderRadius:"50%",background:`${C.amber}18`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:900,color:C.amber,flexShrink:0}}>{i+1}</div>
                      <span style={{fontSize:12,color:C.sub,lineHeight:1.5}}>{ex}</span>
                    </div>
                  ))}
                </Card>
              )}
              {resultIA.retorno&&(
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",background:C.bgGlass,border:`1px solid ${C.border}`,borderRadius:10}}>
                  <span style={{fontSize:12,color:C.muted}}>📅 Retorno / Sessões recomendadas</span>
                  <Badge label={resultIA.retorno} color={C.accent}/>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── PROTOCOLOS FISIOPIEDE ───────────────────────────── */}
      {aba==="protocolos"&&(
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          <div style={{padding:"12px 16px",background:`${C.accent}07`,border:`1px solid ${C.accent}18`,borderRadius:10,fontSize:13,color:C.sub}}>
            📋 Biblioteca de Protocolos Clínicos FisioPiede — clique em uma patologia para ver o protocolo completo e iniciar a análise com IA
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:12}}>
            {Object.entries(PROTOCOLOS_FP).map(([nome,prot])=>(
              <Card key={nome} p={0} style={{overflow:"hidden",border:`1px solid ${prot.cor}20`}}>
                <div style={{padding:"14px 16px",background:`${prot.cor}10`,borderBottom:`1px solid ${prot.cor}20`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:20}}>{prot.icon}</span>
                      <div style={{fontWeight:800,fontSize:14,color:prot.cor}}>{nome}</div>
                    </div>
                    <div style={{display:"flex",gap:5,alignItems:"center"}}>
                      {prot.fases.map((f,i)=><Badge key={i} label={`${f.atendimentos} sessões`} color={prot.cor}/>)}
                    </div>
                  </div>
                  <div style={{fontSize:11,color:C.muted,marginTop:6,lineHeight:1.5}}>{prot.definicao}</div>
                </div>
                <div style={{padding:"12px 16px",display:"flex",flexDirection:"column",gap:10}}>
                  <div>
                    <div style={{fontSize:9,color:C.muted,fontWeight:700,textTransform:"uppercase",marginBottom:4}}>Sintomas</div>
                    <div style={{fontSize:11,color:C.sub,lineHeight:1.5}}>{prot.sintomas}</div>
                  </div>
                  <div style={{padding:"8px 10px",background:`${prot.cor}08`,border:`1px solid ${prot.cor}20`,borderRadius:8}}>
                    <div style={{fontSize:9,color:prot.cor,fontWeight:700,textTransform:"uppercase",marginBottom:4}}>🦶 Palmilha Protocolo</div>
                    <div style={{fontSize:11,color:C.sub,lineHeight:1.5}}>{prot.palmilha.elementos}</div>
                  </div>
                  <div>
                    <div style={{fontSize:9,color:C.muted,fontWeight:700,textTransform:"uppercase",marginBottom:6}}>Exercícios ({prot.exercicios.length})</div>
                    {prot.exercicios.slice(0,3).map((ex,i)=>(
                      <div key={i} style={{fontSize:10,color:C.muted,padding:"3px 0",borderBottom:`1px solid ${C.border}`}}>• {ex.length>70?ex.slice(0,70)+"...":ex}</div>
                    ))}
                    {prot.exercicios.length>3&&<div style={{fontSize:10,color:prot.cor,marginTop:4}}>+{prot.exercicios.length-3} exercícios</div>}
                  </div>
                  <Btn v="primary" full onClick={()=>{setPatologia(nome);setAba("avaliacao");}} style={{justifyContent:"center",background:prot.cor,boxShadow:`0 0 12px ${prot.cor}30`}}>
                    ✦ Iniciar Análise IA — {nome}
                  </Btn>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ─── TRANSCRIÇÃO ─────────────────────────────────────── */}
      {aba==="baropodometria"&&(
        <BaropodometriaIA clinicaId={clinicaId} planoIA={planoIA} pacientes={pacientes} setPacientes={setPacientes} onUsoIA={()=>setTickIA(t=>t+1)}/>
      )}
      {aba==="transcricao"&&(
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          {ehIOS
            ? <div style={{padding:"12px 16px",background:`${C.amber}10`,border:`1px solid ${C.amber}30`,borderRadius:10,fontSize:12,color:C.sub,lineHeight:1.6}}>📱 <strong>A transcrição por voz não é compatível com iPhone/iPad</strong> (limitação do Safari/Apple, vale para qualquer navegador no iPhone). Para gravar a consulta por voz, use um <strong>computador com Chrome ou Edge</strong>. Aqui no iPhone, você pode <strong>digitar ou colar</strong> as notas no campo abaixo — a IA analisa normalmente.</div>
            : <div style={{padding:"12px 16px",background:`${C.accent}07`,border:`1px solid ${C.accent}18`,borderRadius:10,fontSize:12,color:C.sub,lineHeight:1.6}}>🎙️ <strong>Gravação por voz</strong> funciona no sistema publicado (Chrome/Edge com microfone). No preview pode estar bloqueado pelo navegador. Você também pode <strong>digitar ou colar</strong> as notas da consulta abaixo — funciona sempre.</div>
          }
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
            <Card p={24} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:16}}>
              <div style={{fontWeight:800,fontSize:14,alignSelf:"flex-start"}}>Gravação por Voz</div>
              <div style={{position:"relative"}}>
                {rec&&<div style={{position:"absolute",inset:-10,borderRadius:"50%",border:`2px solid ${C.red}`,animation:"ping 1.5s ease-in-out infinite"}}/>}
                <button onClick={rec?transcrever:iniciarGravacao} style={{width:80,height:80,borderRadius:"50%",background:rec?`radial-gradient(circle,${C.red},#B91C1C)`:`radial-gradient(circle,${C.accent},#1D4ED8)`,fontSize:28,boxShadow:rec?`0 0 40px rgba(239,68,68,.5)`:`0 0 30px ${C.glow}`,border:"none",cursor:"pointer",transition:"all .3s"}}>
                  {rec?"⏹":"🎙️"}
                </button>
              </div>
              {rec&&<div style={{textAlign:"center"}}><div style={{fontFamily:"'Space Mono',monospace",fontSize:24,color:C.red,fontWeight:700}}>{fmt}</div><div style={{fontSize:11,color:C.muted,marginTop:3,animation:"pulse 1.5s ease-in-out infinite"}}>🎤 Ouvindo... fale agora</div></div>}
              {!rec&&<div style={{textAlign:"center",color:C.muted,fontSize:12}}>{speechSupported?<>Clique para gravar e transcrever<br/>em tempo real (português).</>:ehIOS?<span style={{color:C.amber}}>📱 Não disponível no iPhone/iPad.<br/>Digite as notas no campo ao lado.</span>:<span style={{color:C.amber}}>⚠️ Navegador sem suporte a voz.<br/>Use o campo de texto ao lado.</span>}</div>}
              {erro&&<div style={{padding:"8px 12px",background:`${C.amber}10`,border:`1px solid ${C.amber}28`,borderRadius:8,fontSize:11,color:C.amber,textAlign:"center"}}>{erro}</div>}
              <Btn v={rec?"danger":"primary"} onClick={rec?transcrever:iniciarGravacao} full disabled={!speechSupported&&!rec}>{rec?"⏹ Parar":"🎙️ Iniciar Gravação"}</Btn>
            </Card>
            <Card p={24}>
              <div style={{fontWeight:800,fontSize:14,marginBottom:12,display:"flex",alignItems:"center",gap:8}}>
                Transcrição / Notas {rec&&<span style={{fontSize:9,color:C.red,fontWeight:700,padding:"2px 7px",background:`${C.red}15`,borderRadius:99,animation:"pulse 1.5s infinite"}}>● AO VIVO</span>}
              </div>
              <textarea
                value={transcript}
                onChange={e=>setTrans(e.target.value)}
                rows={8}
                placeholder="A transcrição da voz aparece aqui em tempo real... ou digite/cole as notas da consulta manualmente."
                style={{width:"100%",fontSize:12,lineHeight:1.7,resize:"vertical",marginBottom:12}}
              />
              <div style={{display:"flex",flexDirection:"column",gap:7}}>
                <Btn v="primary" full disabled={!transcript.trim()} onClick={()=>{setQ(transcript);setAba("avaliacao");}}>✦ Analisar com IA →</Btn>
                {transcript&&<Btn v="ghost" full onClick={()=>setTrans("")}>🗑️ Limpar</Btn>}
              </div>
            </Card>
          </div>

          {/* 🩺 ESCRIBA DA CONSULTA — grava a consulta INTEIRA → prontuário estruturado editável */}
          {!ehIOS && (()=>{
            const nomesPacC = (pacientes||[]).map(p=>`${p.nome} ${p.sobrenome||""}`.trim());
            const pacObjC = (pacientes||[]).find(p=>`${p.nome} ${p.sobrenome||""}`.trim()===pacConsulta);
            const notasPac = (pacObjC&&pacObjC.prontuarios)||[];
            const SECOES = [["queixa","🗣️ Queixa principal"],["historia","📋 História clínica"],["exame","🔍 Exame físico / Avaliação"],["avaliacao","🧠 Hipótese clínica"],["conduta","🦶 Conduta e prescrição"],["orientacoes","💪 Orientações e exercícios"],["retorno","📅 Retorno / Encaminhamentos"]];
            return (
            <Card p={20} style={{border:`1px solid ${C.purple}30`,background:`${C.purple}06`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
                <div>
                  <div style={{fontSize:14,fontWeight:800,color:C.purple}}>🩺 Escriba da Consulta — gravação completa</div>
                  <div style={{fontSize:11.5,color:C.muted,marginTop:3,lineHeight:1.5}}>Grave a <strong>consulta inteira</strong> (até 60 minutos). A IA transcreve tudo, separa <strong>somente os dados clínicos</strong> — sem conversa paralela — e monta o prontuário estruturado para você <strong>revisar, editar e salvar</strong> no paciente. <strong style={{color:C.amber}}>⚠️ Consome 20 análises por consulta</strong>.</div>
                </div>
                {!gravandoAudio
                  ? <Btn v="primary" disabled={transcrevendoAudio||estruturando} onClick={iniciarAudioConsulta} style={{background:C.purple}}>{(transcrevendoAudio||estruturando)?<><Spin sz={14}/> Processando...</>:"🎧 Gravar consulta (20 análises)"}</Btn>
                  : <Btn v="danger" onClick={pararAudioConsulta}>⏹ Encerrar consulta ({fmtAudio})</Btn>
                }
              </div>
              {/* 🎤 Teste de microfone — o paciente é escolhido na hora de salvar */}
              <div style={{marginTop:12,display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                <Btn v="ghost" sz="sm" disabled={testandoMic||gravandoAudio} onClick={testarMicrofone}>{testandoMic?<><Spin sz={12}/> Testando...</>:"🎤 Testar microfone"}</Btn>
                {micStatus==="ok"&&<span style={{fontSize:11,color:C.green,fontWeight:700}}>✓ Microfone funcionando!</span>}
                <span style={{fontSize:11,color:C.muted}}>Dica: grave a consulta e escolha o paciente ao salvar.</span>
              </div>
              {micStatus==="negado"&&(
                <div style={{marginTop:10,padding:"11px 13px",background:`${C.amber}10`,border:`1px solid ${C.amber}40`,borderRadius:9,fontSize:11.5,color:C.sub,lineHeight:1.7}}>
                  <strong style={{color:C.amber}}>🔒 O navegador está bloqueando o microfone para este site.</strong> Para liberar:<br/>
                  1️⃣ Clique no <strong>cadeado 🔒</strong> (ou ⚙️) ao lado do endereço, lá em cima<br/>
                  2️⃣ Encontre <strong>Microfone</strong> e mude para <strong>Permitir</strong><br/>
                  3️⃣ <strong>Recarregue a página</strong> (F5) e clique em 🎤 Testar microfone de novo
                </div>
              )}
              {micStatus==="semMic"&&<div style={{marginTop:10,padding:"9px 13px",background:`${C.amber}10`,border:`1px solid ${C.amber}28`,borderRadius:8,fontSize:11.5,color:C.amber}}>Nenhum microfone foi encontrado neste computador. Conecte um microfone (ou fone com microfone) e teste de novo.</div>}
              {micStatus==="erro"&&<div style={{marginTop:10,padding:"9px 13px",background:`${C.amber}10`,border:`1px solid ${C.amber}28`,borderRadius:8,fontSize:11.5,color:C.amber}}>Não consegui acessar o microfone agora. Use Chrome ou Edge no computador e tente novamente.</div>}
              {gravandoAudio&&<div style={{marginTop:12,padding:"10px 14px",background:`${C.red}0C`,border:`1px solid ${C.red}28`,borderRadius:9,display:"flex",alignItems:"center",gap:10}}><span style={{width:10,height:10,borderRadius:"50%",background:C.red,animation:"pulse 1.2s infinite"}}/><span style={{fontSize:12,color:C.sub}}>Gravando a consulta inteira... <strong style={{fontFamily:"'Space Mono',monospace",color:C.red}}>{fmtAudio}</strong> — atenda normalmente e clique em "Encerrar" no final.</span></div>}
              {(transcrevendoAudio||estruturando)&&<div style={{marginTop:12,display:"flex",alignItems:"center",gap:9,fontSize:12,color:C.purple,fontWeight:600}}><Spin sz={14} color={C.purple}/> {estruturando?"Organizando o prontuário (só os dados clínicos)...":(msgConsulta||"Transcrevendo a consulta...")}</div>}
              {erroAudio&&<div style={{marginTop:12,padding:"9px 13px",background:`${C.amber}10`,border:`1px solid ${C.amber}28`,borderRadius:8,fontSize:11.5,color:C.amber}}>{erroAudio}</div>}

              {/* 📝 PRONTUÁRIO EDITÁVEL */}
              {notaConsulta&&(
                <div style={{marginTop:16,display:"flex",flexDirection:"column",gap:12}}>
                  <div style={{fontSize:12.5,fontWeight:800,color:C.text}}>📝 Prontuário da consulta {editandoNotaId?<span style={{fontSize:10,color:C.amber,fontWeight:700}}>(editando nota salva)</span>:<span style={{fontSize:10,color:C.muted,fontWeight:600}}>— revise e ajuste à vontade antes de salvar</span>}</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    {SECOES.map(([k,rotulo])=>(
                      <div key={k} style={k==="conduta"||k==="orientacoes"?{}:{}}>
                        <label style={{color:C.purple}}>{rotulo}</label>
                        <textarea rows={3} value={notaConsulta[k]||""} onChange={e=>{setNotaConsulta(prev=>({...prev,[k]:e.target.value}));setSalvoConsulta(false);}} placeholder="—" style={{resize:"vertical",fontSize:12,lineHeight:1.6}}/>
                      </div>
                    ))}
                  </div>
                  {transConsulta&&(
                    <div>
                      <button onClick={()=>setMostrarBruta(v=>!v)} style={{background:"none",color:C.muted,fontSize:11,fontWeight:700,padding:0}}>{mostrarBruta?"▾ Ocultar transcrição completa":"▸ Ver transcrição completa da consulta"}</button>
                      {mostrarBruta&&<textarea rows={6} value={transConsulta} onChange={e=>setTransConsulta(e.target.value)} style={{marginTop:6,fontSize:11,lineHeight:1.6,resize:"vertical"}}/>}
                    </div>
                  )}
                  {/* ✅ Salvar em 2 passos bem claros, logo abaixo do prontuário */}
                  {salvoConsulta ? (
                    <div style={{padding:"14px 16px",background:`${C.green}10`,border:`1px solid ${C.green}40`,borderRadius:11,display:"flex",alignItems:"center",gap:11,flexWrap:"wrap"}}>
                      <span style={{fontSize:22}}>✅</span>
                      <div style={{flex:1,minWidth:160}}>
                        <div style={{fontSize:13,fontWeight:800,color:C.green}}>Salvo no prontuário de {pacConsulta}!</div>
                        <div style={{fontSize:11,color:C.muted,marginTop:1}}>A consulta já aparece no histórico do paciente, com o laudo guardado na nuvem.</div>
                      </div>
                      <Btn v="ghost" sz="sm" onClick={imprimirLaudoConsulta}>🖨️ Imprimir laudo</Btn>
                      <Btn v="ghost" sz="sm" onClick={()=>{setNotaConsulta(null);setTransConsulta("");setEditandoNotaId(null);setSalvoConsulta(false);setMostrarBruta(false);setPacConsulta("");}}>✨ Nova consulta</Btn>
                    </div>
                  ) : (
                    <div style={{padding:"14px 16px",background:C.bgGlass,border:`1px solid ${C.purple}30`,borderRadius:11,display:"flex",flexDirection:"column",gap:11}}>
                      <div style={{display:"flex",alignItems:"center",gap:9,flexWrap:"wrap"}}>
                        <span style={{width:22,height:22,borderRadius:"50%",background:pacConsulta?C.green:C.purple,color:"#fff",fontSize:12,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{pacConsulta?"✓":"1"}</span>
                        <span style={{fontSize:12.5,fontWeight:700,color:C.text}}>De qual paciente é esta consulta?</span>
                        <div style={{flex:"1 1 220px",minWidth:180}}>
                          <select value={pacConsulta} onChange={e=>{setPacConsulta(e.target.value);setSalvoConsulta(false);}}>
                            <option value="">👤 Escolher paciente...</option>
                            {nomesPacC.map(n=><option key={n}>{n}</option>)}
                          </select>
                        </div>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:9,flexWrap:"wrap"}}>
                        <span style={{width:22,height:22,borderRadius:"50%",background:pacConsulta?C.purple:C.border,color:pacConsulta?"#fff":C.muted,fontSize:12,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>2</span>
                        <Btn v="primary" disabled={!pacConsulta||salvandoNota} onClick={salvarProntuario} style={{background:pacConsulta?C.purple:undefined,flex:"1 1 240px",justifyContent:"center"}}>{salvandoNota?<><Spin sz={13}/> ☁️ Salvando e enviando o laudo...</>:!pacConsulta?"👆 Escolha o paciente acima primeiro":(editandoNotaId?"💾 Atualizar no prontuário do paciente":"💾 Salvar no prontuário do paciente")}</Btn>
                      </div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap",paddingTop:2}}>
                        <Btn v="ghost" sz="sm" onClick={imprimirLaudoConsulta}>🖨️ Imprimir laudo</Btn>
                        <Btn v="ghost" sz="sm" onClick={()=>{setNotaConsulta(null);setTransConsulta("");setEditandoNotaId(null);setSalvoConsulta(false);setMostrarBruta(false);}}>🗑️ Descartar</Btn>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 📚 Histórico de consultas do paciente selecionado */}
              {pacConsulta&&notasPac.length>0&&(
                <div style={{marginTop:14,paddingTop:12,borderTop:`1px solid ${C.purple}20`}}>
                  <div style={{fontSize:11,fontWeight:800,color:C.purple,marginBottom:8}}>📚 Consultas registradas de {pacConsulta} ({notasPac.length})</div>
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {notasPac.slice().reverse().map(n=>(
                      <div key={n.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,padding:"7px 11px",background:C.bgGlass,border:`1px solid ${C.border}`,borderRadius:8,fontSize:11.5}}>
                        <span style={{color:C.text,fontWeight:600,flexShrink:0}}>{n.data?n.data.split("-").reverse().join("/"):"—"}</span>
                        <span style={{color:C.muted,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{(n.secoes&&n.secoes.queixa)||""}</span>
                        {n.laudoUrl&&<a href={n.laudoUrl} target="_blank" rel="noreferrer" style={{color:C.gold,fontSize:11,fontWeight:700,textDecoration:"none",flexShrink:0}}>🧾 Laudo</a>}
                        <button onClick={()=>abrirNota(n)} style={{background:"none",color:C.accent,fontSize:11,fontWeight:700,padding:0,flexShrink:0}}>✏️ Abrir</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{marginTop:12,fontSize:10,color:C.muted,fontStyle:"italic"}}>⚠️ Grave somente com o consentimento do paciente (LGPD). O prontuário gerado pela IA é um apoio e requer revisão do profissional antes de salvar.</div>
            </Card>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function RelatoriosPage({pedidos,clinicas}) {
  const peds = Array.isArray(pedidos) ? pedidos : [];
  const clis = Array.isArray(clinicas) ? clinicas : [];
  const fat = peds.length * PRECO;

  // Ranking de clínicas (calculado uma vez, de forma segura)
  const ranking = clis
    .map(c => ({ nome: c && c.nome ? c.nome : "—", np: (c && (c.pedidosReal != null ? c.pedidosReal : c.pedidos)) || 0, id: c && c.id }))
    .sort((a, b) => b.np - a.np);
  const maxP = ranking.length && ranking[0].np ? ranking[0].np : 1;

  const exportarExcel = () => {
    try {
      const linhas = [["Clinica", "Pedidos", "Faturamento (R$)"]];
      ranking.forEach(r => linhas.push([r.nome, r.np, (r.np * PRECO).toFixed(2).replace(".", ",")]));
      linhas.push(["", "", ""]); linhas.push(["TOTAL", peds.length, fat.toFixed(2).replace(".", ",")]);
      const csv = "\ufeff" + linhas.map(l => l.join(";")).join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "relatorio-fisiopiede.csv"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { alert("Não foi possível exportar agora."); }
  };

  const exportarPDF = () => {
    try {
      let linhasHtml = "";
      ranking.forEach((r, i) => { linhasHtml += "<tr><td>" + (i + 1) + "</td><td>" + r.nome + "</td><td>" + r.np + "</td><td>R$ " + brl(r.np * PRECO) + "</td></tr>"; });
      const html = "<html><head><meta charset='utf-8'><title>Relatorio FisioPiede</title></head><body style='font-family:Arial,sans-serif;padding:40px'>"
        + "<h1 style='color:#3B82F6'>FisioPiede - Relatorio</h1>"
        + "<p style='color:#666;font-size:12px'>Gerado em " + new Date().toLocaleString("pt-BR") + "</p>"
        + "<p>Faturamento anual estimado: <b>R$ " + brl(fat * 12) + "</b><br>Pedidos totais: <b>" + peds.length + "</b><br>Ticket medio: <b>R$ " + brl(PRECO) + "</b></p>"
        + "<h2 style='font-size:15px'>Performance por Clinica</h2>"
        + "<table style='width:100%;border-collapse:collapse' border='1' cellpadding='6'><tr style='background:#f3f4f6'><th>#</th><th>Clinica</th><th>Pedidos</th><th>Faturamento</th></tr>"
        + linhasHtml + "</table></body></html>";
      const w = window.open("", "_blank");
      if (w) { w.document.write(html); w.document.close(); setTimeout(() => { try { w.print(); } catch (e) {} }, 400); }
      else { alert("Permita pop-ups para gerar o PDF."); }
    } catch (e) { alert("Não foi possível gerar o PDF agora."); }
  };

  const meses = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
  const barData = [28, 45, 52, 61, 48, 67, 72, 58, 81, 76, 89, peds.length];

  return (
    <div style={{ padding: 20 }}>
      <SH title="Relatórios & Analytics" sub="Visão consolidada do negócio" right={<div style={{ display: "flex", gap: 8 }}><Btn v="gold" sz="sm" onClick={exportarPDF}>📄 PDF</Btn><Btn v="subtle" sz="sm" onClick={exportarExcel}>📊 Excel</Btn></div>} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 16 }}>
        {[{ l: "Fat. Anual Est.", v: "R$ " + brl(fat * 12), c: C.green }, { l: "Pedidos Anual Est.", v: (peds.length * 12).toLocaleString("pt-BR"), c: C.accent }, { l: "Ticket Médio", v: "R$ " + brl(PRECO), c: C.gold }].map((m, i) => (
          <Card key={i} p={16}><div style={{ fontSize: 11, color: C.muted, marginBottom: 7 }}>{m.l}</div><div style={{ fontSize: 20, fontWeight: 900, color: m.c }}>{m.v}</div></Card>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, marginBottom: 14 }}>
        <Card p={18}><div style={{ fontWeight: 800, fontSize: 13, marginBottom: 14 }}>Faturamento Mensal 2025</div><Bars data={barData} color={C.green} labels={meses} h={90} /></Card>
        <Card p={18}><div style={{ fontWeight: 800, fontSize: 13, marginBottom: 12 }}>Status dos Pedidos</div>
          {STATUS_FLOW.map(s => {
            const n = peds.filter(p => p.status === s).length;
            const pct = peds.length ? Math.round((n / peds.length) * 100) : 0;
            const sc = STATUS_CFG[s] || { color: C.sub };
            return <div key={s} style={{ marginBottom: 7 }}><div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 2 }}><span style={{ color: C.muted }}>{s}</span><span style={{ fontWeight: 700, color: sc.color }}>{n}</span></div><div style={{ height: 3, background: C.border, borderRadius: 99, overflow: "hidden" }}><div style={{ height: "100%", width: pct + "%", background: sc.color, borderRadius: 99 }} /></div></div>;
          })}
        </Card>
      </div>

      <Card p={18}>
        <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 12 }}>Performance por Clínica</div>
        {ranking.length === 0 ? (
          <div style={{ fontSize: 12, color: C.muted, padding: "12px 0" }}>Nenhuma clínica cadastrada ainda.</div>
        ) : ranking.map((r, i) => {
          const pct = Math.round((r.np / maxP) * 100);
          return (
            <div key={r.id || i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7 }}>
              <span style={{ fontSize: 10, color: C.muted, width: 18, textAlign: "right" }}>#{i + 1}</span>
              <span style={{ fontSize: 12, fontWeight: 600, width: 185, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.nome}</span>
              <div style={{ flex: 1, height: 5, background: C.border, borderRadius: 99, overflow: "hidden" }}><div style={{ height: "100%", width: pct + "%", background: "linear-gradient(90deg," + C.accent + "," + C.purple + ")", borderRadius: 99 }} /></div>
              <span style={{ fontSize: 11, fontWeight: 800, color: C.accent, width: 35, textAlign: "right" }}>{r.np}</span>
              <span style={{ fontSize: 10, color: C.green, width: 75, textAlign: "right" }}>R$ {brl(r.np * PRECO)}</span>
            </div>
          );
        })}
      </Card>
    </div>
  );
}

// ─── DASHBOARDS CLÍNICA / PACIENTE ─────────────────────────────────────────────
// 🚀 Primeiros Passos — checklist de boas-vindas da clínica recém-licenciada.
// Os 2 primeiros passos são detectados automaticamente pelos dados reais;
// os 2 últimos são marcados quando a clínica visita a tela. Some ao concluir/dispensar.
function PrimeirosPassos({pacientes,pedidos,clinicaId,onNavegar}){
  const key = "fp:onboarding:"+(clinicaId||"geral");
  const [extra,setExtra] = useState(()=>LS.read(key)||{});
  if(extra.dispensado) return null;
  const marcar = (campo)=>{ const n={...extra,[campo]:true}; setExtra(n); LS.write(key,n); };
  const passos = [
    {id:"pac", icon:"👤", t:"Cadastre seu primeiro paciente", d:"A porta de entrada de tudo: prontuário, pedidos e IA.", feito:(pacientes||[]).length>0, acao:"Cadastrar", pg:"pacientes"},
    {id:"ped", icon:"📦", t:"Crie o primeiro pedido de palmilha", d:"Anexe a digitalização 3D e acompanhe a produção.", feito:(pedidos||[]).length>0, acao:"Criar pedido", pg:"pedidos"},
    {id:"mkt", icon:"📣", t:"Conheça o Marketing Hub", d:"Posts prontos por patologia e imagens com IA pra atrair pacientes.", feito:!!extra.mkt, acao:"Explorar", pg:"marketing"},
    {id:"acad",icon:"🎓", t:"Visite a Academy", d:"Trilhas e apostilas pra sua equipe dominar a posturologia.", feito:!!extra.acad, acao:"Visitar", pg:"academy"},
  ];
  const feitos = passos.filter(p=>p.feito).length;
  const pct = Math.round((feitos/passos.length)*100);
  const completo = feitos===passos.length;
  return (
    <Card hover={false} p={0} style={{border:`1px solid ${completo?C.green:C.accent}40`,overflow:"hidden"}}>
      <div style={{padding:"15px 18px",background:completo?`${C.green}0A`:`linear-gradient(135deg,${C.accent}0C,${C.purple}07)`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <div>
            <div style={{fontSize:14.5,fontWeight:800}}>{completo?"🎉 Você completou os primeiros passos!":"🚀 Primeiros passos na FisioPiede"}</div>
            <div style={{fontSize:11,color:C.muted,marginTop:2}}>{completo?"Sua clínica está pronta pra decolar. Bom trabalho!":"Complete o checklist e deixe sua clínica 100% operacional."}</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{fontSize:12,fontWeight:800,color:completo?C.green:C.accent}}>{feitos}/{passos.length}</div>
            <div style={{width:110,height:7,background:C.bgCard,borderRadius:99,overflow:"hidden",border:`1px solid ${C.border}`}}>
              <div style={{width:`${pct}%`,height:"100%",borderRadius:99,background:completo?C.green:`linear-gradient(90deg,${C.accent},${C.purple})`,transition:"width .5s ease"}}/>
            </div>
          </div>
        </div>
      </div>
      {!completo && (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(230px,1fr))",gap:0}}>
          {passos.map((p,i)=>(
            <div key={p.id} style={{padding:"13px 16px",borderTop:`1px solid ${C.border}`,borderLeft:i%2===1?`1px solid ${C.border}`:"none",opacity:p.feito?.62:1,display:"flex",flexDirection:"column",gap:6}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{width:20,height:20,borderRadius:"50%",flexShrink:0,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:900,background:p.feito?C.green:C.bgGlass,color:p.feito?"#fff":C.muted,border:p.feito?"none":`1px solid ${C.border}`}}>{p.feito?"✓":i+1}</span>
                <span style={{fontSize:12.5,fontWeight:800,textDecoration:p.feito?"line-through":"none"}}>{p.icon} {p.t}</span>
              </div>
              <div style={{fontSize:10.5,color:C.muted,lineHeight:1.5,paddingLeft:28}}>{p.d}</div>
              {!p.feito && <div style={{paddingLeft:28}}><Btn v="subtle" sz="sm" onClick={()=>{ if(p.id==="mkt"||p.id==="acad") marcar(p.id); onNavegar&&onNavegar(p.pg); }}>{p.acao} →</Btn></div>}
            </div>
          ))}
        </div>
      )}
      <div style={{padding:"8px 16px",borderTop:`1px solid ${C.border}`,display:"flex",justifyContent:completo?"center":"flex-end"}}>
        {completo
          ? <Btn v="success" sz="sm" onClick={()=>marcar("dispensado")}>Ocultar checklist ✓</Btn>
          : <button onClick={()=>marcar("dispensado")} style={{background:"none",color:C.muted,fontSize:10.5,cursor:"pointer"}}>Já conheço a plataforma — dispensar</button>}
      </div>
    </Card>
  );
}

function DashClinica({pedidos,pacientes,clinicaObj,hideValues,onNavegar,planoIA,consultas}) {
  // pedidos e pacientes já chegam filtrados pelo App
  const meus   = pedidos;
  const emProd = meus.filter(p=>["Em Produção","Impressão 3D","Acabamento"].includes(p.status)).length;
  const total  = meus.length*PRECO;
  const clinicaName = clinicaObj?.nome||"Minha Clínica";
  // 📡 Cota de IA — aviso quando a clínica passa de 80% do limite mensal
  const limiteIA = (planoIA && planoIA!=="admin") ? ((IA_LIMITE[planoIA]!==undefined?IA_LIMITE[planoIA]:0) + creditoExtraIA(clinicaObj?.id)) : 0;
  const usoIA = limiteIA>0 ? IA_USO.atual(clinicaObj?.id) : 0;
  const pctIA = limiteIA>0 ? usoIA/limiteIA : 0;
  const iaEsgotando = limiteIA>0 && pctIA>=0.8;
  // 🔄 puxa o contador real da nuvem (mesma regra do IAPage: prevalece o maior)
  const [,setSyncIA] = useState(0);
  useEffect(()=>{ (async()=>{
    try{
      const k = IA_USO._key(clinicaObj?.id);
      const nuvem = await LS.readAsync(k);
      if(nuvem && typeof nuvem.n === "number"){
        const local = LS.read(k);
        if(!local || typeof local.n!=="number" || local.n < nuvem.n){ LS.write(k, nuvem, true); setSyncIA(t=>t+1); }
      }
    }catch(e){}
  })(); },[clinicaObj?.id]);
  const mesAtualStr = (()=>{ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; })();
  const consultasMes = (consultas||[]).filter(c=>String(c.data||"").startsWith(mesAtualStr) && c.status!=="Cancelada").length;
  const ultimasNotas = (pacientes||[]).flatMap(p=>(p.prontuarios||[]).map(n=>({ ...n, pacNome:`${p.nome} ${p.sobrenome||""}`.trim() }))).sort((a,b)=>String(b.data||"").localeCompare(String(a.data||""))).slice(0,5);
  // 📲 Retornos: atrasados + próximos 7 dias, com lembrete de WhatsApp em 1 clique
  const hoje0 = new Date(); hoje0.setHours(0,0,0,0);
  const em7 = new Date(hoje0.getTime() + 7*86400000);
  const parseRet = (d)=>{ if(!d) return null; const dt = new Date(String(d).length===10 ? d+"T00:00:00" : d); return isNaN(dt.getTime()) ? null : dt; };
  const foneZap = (tel)=>{ let dig = String(tel||"").replace(/\D/g,""); if(!dig) return null; if(dig.length===10||dig.length===11) dig = "55"+dig; return dig.length>=12 ? dig : null; };
  // ✅ "Já contatei": guardado por paciente+data do retorno, some da lista de pendência
  const [contatados,setContatados] = useState(() => LS.read("fp:retorno_contatado") || {});
  const chaveRet = (id,dt)=>`${id}@${dt.toISOString().split("T")[0]}`;
  const marcarContatado = (chave)=>{ const n={...contatados,[chave]:Date.now()}; setContatados(n); LS.write("fp:retorno_contatado",n); };
  const desfazerContatado = (chave)=>{ const n={...contatados}; delete n[chave]; setContatados(n); LS.write("fp:retorno_contatado",n); };
  const retornosTodos = (pacientes||[])
    .map(p=>({ p, dt: parseRet(p.dataRetorno) }))
    .filter(x=>x.dt && x.dt <= em7)
    .sort((a,b)=>a.dt-b.dt)
    .map(x=>{
      const nome = `${x.p.nome} ${x.p.sobrenome||""}`.trim();
      const status = x.dt < hoje0 ? "atrasado" : (x.dt.getTime()===hoje0.getTime() ? "hoje" : "proximo");
      const fone = foneZap(x.p.whatsapp);
      const msg = `Olá, ${x.p.nome}! 👋 Aqui é da ${clinicaName}. Está chegando a data do seu retorno para acompanharmos sua evolução e suas palmilhas. Vamos agendar seu horário? 🦶✨`;
      const zap = fone ? `https://wa.me/${fone}?text=${encodeURIComponent(msg)}` : null;
      const chave = chaveRet(x.p.id, x.dt);
      return { id:x.p.id, nome, dt:x.dt, dataTxt:x.dt.toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"}), status, zap, chave, contatado: !!contatados[chave] };
    });
  const retornos = retornosTodos.filter(r=>!r.contatado).slice(0,6);
  const jaContatados = retornosTodos.filter(r=>r.contatado).slice(0,6);
  const urgentesPend = retornosTodos.filter(r=>!r.contatado && (r.status==="atrasado"||r.status==="hoje"));
  return (
    <div style={{padding:20,display:"flex",flexDirection:"column",gap:16}}>
      <SH title={`Dashboard — ${clinicaName}`} sub={new Date().toLocaleDateString("pt-BR",{day:"numeric",month:"long",year:"numeric"})}/>
      {urgentesPend.length>0 && (
        <Card hover={false} p={0} style={{overflow:"hidden",border:`1px solid ${C.red}45`}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,padding:"13px 16px",background:`${C.red}0C`,flexWrap:"wrap"}}>
            <div style={{display:"flex",alignItems:"center",gap:11}}>
              <span style={{fontSize:22}}>🔔</span>
              <div>
                <div style={{fontSize:13,fontWeight:800,color:C.red}}>{urgentesPend.length} retorno{urgentesPend.length!==1?"s":""} precisa{urgentesPend.length!==1?"m":""} de atenção hoje</div>
                <div style={{fontSize:11,color:C.muted,marginTop:2}}>{urgentesPend.filter(r=>r.status==="atrasado").length>0?`${urgentesPend.filter(r=>r.status==="atrasado").length} atrasado(s)`:""}{urgentesPend.filter(r=>r.status==="atrasado").length>0&&urgentesPend.filter(r=>r.status==="hoje").length>0?" · ":""}{urgentesPend.filter(r=>r.status==="hoje").length>0?`${urgentesPend.filter(r=>r.status==="hoje").length} vence(m) hoje`:""} — lembre logo abaixo 👇</div>
              </div>
            </div>
            <Badge label={`📲 ${urgentesPend.length} para contatar`} color={C.red}/>
          </div>
        </Card>
      )}
      {/* ⚡ Central de IA — medidor sempre visível */}
      {planoIA!=="admin" && (()=>{
        const temIA = limiteIA>0;
        const cor = !temIA ? C.purple : pctIA>=1 ? C.red : pctIA>=0.8 ? C.amber : C.green;
        const restantes = Math.max(0, limiteIA-usoIA);
        return (
          <Card hover={false} p={0} style={{overflow:"hidden",border:`1px solid ${cor}35`}}>
            <div style={{padding:"15px 18px",background:`linear-gradient(135deg,${C.purple}10,${cor}08)`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                <div style={{display:"flex",alignItems:"center",gap:11}}>
                  <div style={{width:40,height:40,borderRadius:11,background:`${C.purple}20`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>⚡</div>
                  <div>
                    <div style={{fontSize:13.5,fontWeight:800}}>Central de IA <span style={{fontSize:10,color:C.purple,fontWeight:700}}>· plano {planoIA}</span></div>
                    <div style={{fontSize:10.5,color:C.muted,marginTop:1}}>{temIA ? `Escriba de consultas, baropodometria, protocolos e marketing` : "Sua porta de entrada para o Escriba, baropodometria e protocolos com IA"}</div>
                  </div>
                </div>
                <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                  {temIA && <Btn v="subtle" sz="sm" onClick={()=>onNavegar&&onNavegar("ia")}>✨ Usar a IA →</Btn>}
                  {temIA && pctIA>=0.5 && <Btn v="primary" sz="sm" onClick={()=>onNavegar&&onNavegar("ia")}>✦ +50 análises · R$ 49,90</Btn>}
                  {!temIA && <Btn v="primary" sz="sm" onClick={()=>onNavegar&&onNavegar("planos")}>🚀 Desbloquear IA →</Btn>}
                </div>
              </div>
              {temIA && (
                <div style={{marginTop:12}}>
                  <div style={{height:9,borderRadius:99,background:`${C.border}`,overflow:"hidden"}}>
                    <div style={{height:"100%",width:`${Math.min(100,Math.round(pctIA*100))}%`,borderRadius:99,background:`linear-gradient(90deg,${cor},${cor}AA)`,transition:"width .6s ease"}}/>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",marginTop:6,fontSize:10.5}}>
                    <span style={{color:C.muted}}><strong style={{color:cor}}>{usoIA}</strong> de {limiteIA} análises usadas no mês</span>
                    <span style={{fontWeight:800,color:cor}}>{pctIA>=1?"🚫 cota esgotada":`${restantes} restantes`}</span>
                  </div>
                </div>
              )}
            </div>
          </Card>
        );
      })()}
      <PrimeirosPassos pacientes={pacientes} pedidos={pedidos} clinicaId={clinicaObj?.id} onNavegar={onNavegar}/>
      {(()=>{
        const hoje = fmtDate(new Date());
        const doDia = (consultas||[]).filter(c=>c.data===hoje && c.status!=="Cancelada").sort((a,b)=>String(a.hora||"").localeCompare(String(b.hora||"")));
        return (
          <Card hover={false} p={0} style={{overflow:"hidden"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,padding:"13px 16px",borderBottom:doDia.length>0?`1px solid ${C.border}`:"none",flexWrap:"wrap"}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:20}}>📅</span>
                <div>
                  <div style={{fontSize:13.5,fontWeight:800}}>Agenda de hoje</div>
                  <div style={{fontSize:10.5,color:C.muted}}>{doDia.length>0?`${doDia.length} compromisso${doDia.length!==1?"s":""} agendado${doDia.length!==1?"s":""}`:"Dia livre por enquanto — que tal agendar os retornos?"}</div>
                </div>
              </div>
              <Btn v="subtle" sz="sm" onClick={()=>onNavegar&&onNavegar("agenda")}>Ver agenda completa →</Btn>
            </div>
            {doDia.slice(0,5).map(c=>(
              <div key={c.id} style={{display:"flex",alignItems:"center",gap:11,padding:"9px 16px",borderTop:`1px solid ${C.border}`}}>
                <div style={{fontFamily:"'Space Mono',monospace",fontSize:12,fontWeight:800,color:C.accent,minWidth:46}}>{c.hora}</div>
                <div style={{flex:1,minWidth:0,fontSize:12,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.paciente}</div>
                <Badge label={c.tipo||"Consulta"} color={c.status==="Confirmada"?C.green:C.accent}/>
              </div>
            ))}
            {doDia.length>5&&<div style={{padding:"7px 16px",fontSize:10.5,color:C.muted,borderTop:`1px solid ${C.border}`}}>+ {doDia.length-5} compromisso(s) — veja na agenda</div>}
          </Card>
        );
      })()}
      {!hideValues && (
      <Card hover={false} p={24} style={{background:`linear-gradient(135deg,${C.accent}08,${C.purple}05)`,border:`1px solid ${C.accent}20`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:16}}>
          <div>
            <div style={{fontSize:12,color:C.muted,marginBottom:10}}>Resumo Financeiro — {new Date().toLocaleDateString("pt-BR",{month:"long",year:"numeric"}).replace(/^./,c=>c.toUpperCase())}</div>
            <div style={{display:"flex",gap:36,alignItems:"flex-end",flexWrap:"wrap"}}>
              <div><div style={{fontSize:10,color:C.muted,marginBottom:3}}>Pedidos do mês</div><div style={{fontSize:34,fontWeight:900}}><ANum value={meus.length}/></div></div>
              <div><div style={{fontSize:10,color:C.muted,marginBottom:3}}>Valor por pedido</div><div style={{fontSize:34,fontWeight:900,color:C.sub}}>R$ {brl(PRECO)}</div></div>
              <div><div style={{fontSize:10,color:C.muted,marginBottom:3}}>Total a pagar</div><div style={{fontSize:34,fontWeight:900,color:C.amber}}>R$ <ANum value={total}/></div></div>
            </div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:7}}>
            <Btn v="primary">💳 Pagar via PIX</Btn>
            <Btn v="primary" onClick={()=>onNavegar&&onNavegar("planos")}>💳 Pagar com cartão</Btn>
            <Btn v="ghost">📄 Boleto</Btn>
            <Btn v="outline" onClick={()=>onNavegar&&onNavegar("pedidos")}>📋 Ir para o fechamento</Btn>
          </div>
        </div>
      </Card>
      )}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12}}>
        <MCard label="Pedidos no mês" value={meus.length} icon="📦" color={C.accent} delay={0}/>
        <MCard label="Em produção" value={emProd}      icon="⚙️" color={C.amber}  delay={.05}/>
        <MCard label="Entregues"    value={meus.filter(p=>p.status==="Entregue").length} icon="✅" color={C.green} delay={.1}/>
        <MCard label="Pacientes"    value={pacientes.length} icon="👤" color={C.purple} delay={.15}/>
        <MCard label="Consultas no mês" value={consultasMes} icon="🩺" color={C.gold} delay={.2}/>
      </div>
      <Card p={18}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}><div style={{fontWeight:800,fontSize:13}}>Meus Pedidos Recentes</div><Badge label="Atualizado agora" color={C.green}/></div>
        {meus.slice(0,5).map(p=>(
          <div key={p.id} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:9,background:C.bgGlass,border:`1px solid ${C.border}`,marginBottom:5}}>
            <span style={{fontFamily:"'Space Mono',monospace",fontSize:9,color:C.accent,width:36,flexShrink:0}}>{p.id}</span>
            <span style={{flex:1,fontWeight:600,fontSize:12}}>{p.paciente}</span>
            <SBadge status={p.status}/>
            {p.rastreio&&<a href={`https://rastreamento.correios.com.br/app/index.php?objetos=${p.rastreio}`} target="_blank" rel="noreferrer" style={{fontSize:10,color:C.green,fontWeight:700,textDecoration:"none"}}>🔗</a>}
            <span style={{fontSize:10,color:C.muted}}>{fmtD(p.data)}</span>
          </div>
        ))}
      </Card>

      {/* 🩺 Últimos prontuários do Escriba */}
      <Card hover={false} p={0} style={{overflow:"hidden",border:`1px solid ${C.purple}22`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,padding:"13px 16px",borderBottom:ultimasNotas.length>0?`1px solid ${C.border}`:"none",flexWrap:"wrap"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:20}}>🩺</span>
            <div>
              <div style={{fontSize:13.5,fontWeight:800}}>Últimos prontuários do Escriba</div>
              <div style={{fontSize:10.5,color:C.muted}}>{ultimasNotas.length>0?"Consultas gravadas e organizadas pela IA":"Grave uma consulta e deixe a IA montar o prontuário para você"}</div>
            </div>
          </div>
          <Btn v="subtle" sz="sm" onClick={()=>onNavegar&&onNavegar("ia")}>{ultimasNotas.length>0?"Abrir o Escriba →":"🎧 Gravar primeira consulta →"}</Btn>
        </div>
        {ultimasNotas.map(n=>(
          <div key={n.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 16px",borderTop:`1px solid ${C.border}`}}>
            <span style={{fontFamily:"'Space Mono',monospace",fontSize:10.5,fontWeight:800,color:C.purple,flexShrink:0}}>{n.data?n.data.split("-").reverse().join("/"):"—"}</span>
            <span style={{fontSize:12,fontWeight:700,flexShrink:0}}>{n.pacNome}</span>
            <span style={{flex:1,minWidth:0,fontSize:11,color:C.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{(n.secoes&&n.secoes.queixa)||""}</span>
            {n.laudoUrl&&<a href={n.laudoUrl} target="_blank" rel="noreferrer" style={{fontSize:10.5,color:C.gold,fontWeight:700,textDecoration:"none",flexShrink:0}}>🧾 Laudo</a>}
          </div>
        ))}
      </Card>

      {/* 📲 Lembretes de retorno automáticos */}
      <Card hover={false} p={0} style={{overflow:"hidden",border:`1px solid ${C.green}25`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,padding:"13px 16px",borderBottom:retornos.length>0?`1px solid ${C.border}`:"none",flexWrap:"wrap"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:20}}>📲</span>
            <div>
              <div style={{fontSize:13.5,fontWeight:800}}>Retornos para lembrar</div>
              <div style={{fontSize:10.5,color:C.muted}}>{retornos.length>0?`${retornos.length} paciente${retornos.length!==1?"s":""} com retorno atrasado ou nos próximos 7 dias — lembre com 1 clique`:"Nenhum retorno por perto — defina a data de retorno no cadastro do paciente e eu te aviso aqui"}</div>
            </div>
          </div>
          <Btn v="subtle" sz="sm" onClick={()=>onNavegar&&onNavegar("pacientes")}>Ver pacientes →</Btn>
        </div>
        {retornos.map(r=>(
          <div key={r.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 16px",borderTop:`1px solid ${C.border}`,flexWrap:"wrap"}}>
            <Badge label={r.status==="atrasado"?`⏰ Atrasado · ${r.dataTxt}`:r.status==="hoje"?"📍 É hoje!":`📅 ${r.dataTxt}`} color={r.status==="atrasado"?C.red:r.status==="hoje"?C.amber:C.green}/>
            <span style={{flex:1,minWidth:0,fontSize:12,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.nome}</span>
            {r.zap
              ? <a href={r.zap} target="_blank" rel="noreferrer" style={{display:"inline-flex",alignItems:"center",gap:6,padding:"6px 12px",borderRadius:8,background:`${C.green}18`,border:`1px solid ${C.green}40`,color:C.green,fontSize:11,fontWeight:800,textDecoration:"none",flexShrink:0}}>📲 Lembrar no WhatsApp</a>
              : <span style={{fontSize:10.5,color:C.muted,fontStyle:"italic",flexShrink:0}}>sem WhatsApp no cadastro</span>}
            <button onClick={()=>marcarContatado(r.chave)} title="Marcar como já contatado" style={{display:"inline-flex",alignItems:"center",gap:5,padding:"6px 11px",borderRadius:8,background:C.bgGlass,border:`1px solid ${C.border}`,color:C.sub,fontSize:11,fontWeight:700,cursor:"pointer",flexShrink:0}}>✓ Já contatei</button>
          </div>
        ))}
        {jaContatados.length>0 && (
          <div style={{borderTop:`1px solid ${C.border}`,padding:"9px 16px",background:`${C.green}05`}}>
            <div style={{fontSize:10,fontWeight:700,color:C.muted,marginBottom:6}}>✓ Já contatados ({jaContatados.length})</div>
            {jaContatados.map(r=>(
              <div key={r.id} style={{display:"flex",alignItems:"center",gap:9,padding:"4px 0"}}>
                <span style={{fontSize:11.5,color:C.muted,textDecoration:"line-through",flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.nome} · {r.dataTxt}</span>
                <button onClick={()=>desfazerContatado(r.chave)} style={{background:"none",color:C.accent,fontSize:10.5,fontWeight:700,padding:0,flexShrink:0}}>desfazer</button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Tecnologia FisioPiede */}
      <Card hover={false} p={0} style={{overflow:"hidden",border:`1px solid ${C.gold}25`}}>
        <div style={{padding:"18px 20px",background:`linear-gradient(135deg,${C.gold}12,${C.purple}06)`,display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:42,height:42,borderRadius:11,background:`${C.gold}20`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>🦿</div>
          <div><div style={{fontWeight:800,fontSize:15}}>Tecnologia FisioPiede — Palmilhas 3D em TPU</div><div style={{fontSize:11,color:C.muted}}>O processo exclusivo que você entrega ao seu paciente</div></div>
        </div>
        <div style={{padding:"16px 20px",display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:12}}>
          {[
            ["📋","Avaliação biomecânica","O fisioterapeuta avalia postura, marcha e pisada e define os elementos corretivos no protocolo técnico."],
            ["📸","Escaneamento 3D","Captura precisa da anatomia plantar do paciente em três dimensões."],
            ["💻","Modelagem digital","Software de última geração constrói a palmilha sobre o molde exato, posicionando cada correção."],
            ["🖨️","Impressão em TPU","Material de alta performance: durável, com memória elástica, conforto e absorção de impactos. Arcos moldados na impressão — pioneiro no Brasil."],
          ].map(([ic,t,d],i)=>(
            <div key={i} style={{padding:14,background:C.bgGlass,borderRadius:10,border:`1px solid ${C.border}`}}>
              <div style={{fontSize:22,marginBottom:6}}>{ic}</div>
              <div style={{fontSize:12,fontWeight:800,marginBottom:4}}>{t}</div>
              <div style={{fontSize:11,color:C.muted,lineHeight:1.6}}>{d}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─── ÁREA DO PACIENTE ─────────────────────────────────────────────────────────
function DashPaciente({paciente, pedidos, consultas}) {
  const pac = paciente || {};
  const prot = pac.patologia ? PROTOCOLOS_FP[pac.patologia] : null;
  const meuPedido = (pedidos||[]).find(p=>p.pacienteId===pac.id) || (pedidos||[])[0];
  const curStatus = meuPedido?.status || "Recebido";
  const proxConsulta = pac.dataRetorno || "—";
  const exs = (pac.patologia && EXERCICIOS_PACIENTE[pac.patologia]) ? EXERCICIOS_PACIENTE[pac.patologia] : (prot ? prot.exercicios : []);
  const numExerc = exs.length;
  const hora = new Date().getHours();
  const saudacao = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";

  return (
    <div style={{padding:20,display:"flex",flexDirection:"column",gap:16}}>
      {/* Hero de boas-vindas premium */}
      <Card hover={false} p={0} style={{overflow:"hidden",border:`1px solid ${C.accent}22`}}>
        <div style={{padding:"22px 24px",background:`linear-gradient(135deg,${C.accent}14,${C.purple}08)`,display:"flex",alignItems:"center",gap:16}}>
          <div style={{width:60,height:60,borderRadius:"50%",background:`linear-gradient(135deg,${C.accent},${C.purple})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,fontWeight:900,color:"#fff",flexShrink:0,boxShadow:`0 0 24px ${C.accent}40`}}>{(pac.nome||"?").charAt(0)}</div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:11,color:C.muted}}>{saudacao},</div>
            <div style={{fontSize:22,fontWeight:900,lineHeight:1.1}}>{pac.nome} {pac.sobrenome}</div>
            <div style={{fontSize:11,color:C.accent,fontWeight:600,marginTop:3}}>🏥 {pac.clinica||"FisioPiede"}</div>
          </div>
          <div style={{textAlign:"center",flexShrink:0}}>
            <div style={{width:40,height:40,borderRadius:11,background:`${C.green}15`,border:`1px solid ${C.green}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>✓</div>
            <div style={{fontSize:9,color:C.muted,marginTop:4}}>em tratamento</div>
          </div>
        </div>
      </Card>

      {/* Cartão da patologia */}
      {prot ? (
        <Card hover={false} p={22} style={{background:`linear-gradient(135deg,${prot.cor}10,${prot.cor}04)`,border:`1px solid ${prot.cor}25`}}>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
            <div style={{width:44,height:44,borderRadius:12,background:`${prot.cor}18`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24}}>{prot.icon}</div>
            <div>
              <div style={{fontSize:10,color:prot.cor,fontWeight:700,textTransform:"uppercase"}}>Seu diagnóstico</div>
              <div style={{fontSize:17,fontWeight:900}}>{pac.patologia}</div>
            </div>
          </div>
          <div style={{fontSize:12,color:C.sub,lineHeight:1.7}}>{prot.definicao}</div>
        </Card>
      ) : (
        <Card hover={false} p={20} style={{textAlign:"center",color:C.muted}}>
          <div style={{fontSize:32,marginBottom:8}}>🩺</div>
          <div style={{fontSize:13}}>Sua patologia ainda não foi definida pela clínica.</div>
        </Card>
      )}

      {/* Métricas rápidas */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:11}}>
        {[["💪","Exercícios",numExerc+" prescritos"],["📅","Retorno",proxConsulta!=="—"?proxConsulta.split("-").reverse().join("/"):"—"],["📦","Palmilha",meuPedido?curStatus:"—"]].map(([i,l,v],idx)=>(
          <Card key={idx} p={16} style={{textAlign:"center"}}><div style={{fontSize:22,marginBottom:7}}>{i}</div><div style={{fontSize:15,fontWeight:900}}>{v}</div><div style={{fontSize:10,color:C.muted,marginTop:3}}>{l}</div></Card>
        ))}
      </div>

      {/* Status da palmilha */}
      {meuPedido && (
        <Card hover={false} p={20}>
          <div style={{fontWeight:800,fontSize:14,marginBottom:14}}>Status da sua palmilha 🦶</div>
          <div style={{marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:5}}>{STATUS_FLOW.map(s=>{const sc2=STATUS_CFG[s]||{color:C.sub};const done=STATUS_FLOW.indexOf(s)<=STATUS_FLOW.indexOf(curStatus);return<span key={s} style={{color:done?sc2.color:C.muted}}>{sc2.icon}</span>;})}</div>
            <div style={{height:5,background:C.border,borderRadius:99,overflow:"hidden"}}><div style={{height:"100%",width:`${((STATUS_FLOW.indexOf(curStatus)+1)/STATUS_FLOW.length)*100}%`,background:`linear-gradient(90deg,${C.accent},${C.purple})`,borderRadius:99,transition:"width 1s"}}/></div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}><SBadge status={curStatus}/>{meuPedido.rastreio&&<span style={{fontSize:12,color:C.muted}}>Rastreio: <strong style={{color:C.text}}>{meuPedido.rastreio}</strong></span>}</div>
        </Card>
      )}

      {/* Evolução da dor — paciente registra */}
      <EvolucaoDor pacienteId={pac.id} editavel={true}/>
    </div>
  );
}

// Página: Minha Patologia — explica a condição do paciente
function PatologiaPacientePage({paciente}) {
  const pac = paciente || {};
  const prot = pac.patologia ? PROTOCOLOS_FP[pac.patologia] : null;
  if(!prot) return (
    <div style={{padding:20}}>
      <SH title="Minha Patologia" sub="Informações sobre sua condição"/>
      <Card p={30} style={{textAlign:"center",color:C.muted}}><div style={{fontSize:40,marginBottom:10}}>🩺</div>Sua patologia ainda não foi definida pela clínica.<br/>Entre em contato com seu fisioterapeuta.</Card>
    </div>
  );
  return (
    <div style={{padding:20,display:"flex",flexDirection:"column",gap:16}}>
      <SH title="Minha Patologia" sub={`Entenda sobre ${pac.patologia}`}/>
      <Card hover={false} p={24} style={{background:`linear-gradient(135deg,${prot.cor}10,${prot.cor}04)`,border:`1px solid ${prot.cor}25`}}>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <div style={{width:56,height:56,borderRadius:16,background:`${prot.cor}18`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:30}}>{prot.icon}</div>
          <div><div style={{fontSize:22,fontWeight:900}}>{pac.patologia}</div><div style={{fontSize:12,color:prot.cor,fontWeight:600}}>Material educativo FisioPiede</div></div>
        </div>
      </Card>

      {[["📖 O que é?",prot.definicao],["🔍 Sintomas comuns",prot.sintomas],["💡 Como tratamos",prot.tratamento],["🏠 Cuidados em casa",prot.indicacoesCasa]].map(([t,v])=>(
        <Card key={t} p={18}>
          <div style={{fontSize:13,fontWeight:800,marginBottom:8,color:prot.cor}}>{t}</div>
          <div style={{fontSize:13,color:C.sub,lineHeight:1.8}}>{v}</div>
        </Card>
      ))}

      <Card hover={false} p={18} style={{background:`${C.accent}06`,border:`1px solid ${C.accent}18`}}>
        <div style={{fontSize:12,color:C.sub,lineHeight:1.7}}>
          ℹ️ Estas informações são educativas. Siga sempre as orientações do seu fisioterapeuta. Em caso de dúvidas ou piora dos sintomas, entre em contato com sua clínica.
        </div>
      </Card>
    </div>
  );
}

// Página: Exercícios — do protocolo da patologia, com espaço para foto/vídeo
// Pôsteres de exercícios por patologia (imagens servidas de public/posters/)
const POSTER_PATOLOGIA = {
  "Fascite Plantar": "/posters/fascite-plantar.jpg",
  "Fascite plantar": "/posters/fascite-plantar.jpg",
  "Fasciíte Plantar": "/posters/fascite-plantar.jpg",
  "Fasciite Plantar": "/posters/fascite-plantar.jpg",
  "Metatarsalgia": "/posters/metatarsalgia.jpg",
  "Esporão de Calcâneo": "/posters/esporao-calcaneo.jpg",
  "Esporão de calcâneo": "/posters/esporao-calcaneo.jpg",
  "Tendinite Patelar": "/posters/tendinite-patelar.jpg",
  "Tendinite patelar": "/posters/tendinite-patelar.jpg",
  "Banda Iliotibial": "/posters/banda-iliotibial.jpg",
  "Síndrome da Banda Iliotibial": "/posters/banda-iliotibial.jpg",
  "Pés Planos": "/posters/pes-planos.jpg",
  "Pés planos": "/posters/pes-planos.jpg",
  "Pé Plano": "/posters/pes-planos.jpg",
  "Condromalácia": "/posters/condromalacia.jpg",
  "Condromalácia Patelar": "/posters/condromalacia.jpg",
  "Pés Cavos": "/posters/pes-cavos.jpg",
  "Pés cavos": "/posters/pes-cavos.jpg",
  "Pé Cavo": "/posters/pes-cavos.jpg",
};
// Busca tolerante (ignora acentos/maiúsculas) para casar a patologia do paciente com o pôster
function getPosterPatologia(patologia){
  if(!patologia) return null;
  if(POSTER_PATOLOGIA[patologia]) return POSTER_PATOLOGIA[patologia];
  const norm = (s)=>s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z]/g,"");
  const alvo = norm(patologia);
  for(const k of Object.keys(POSTER_PATOLOGIA)){
    if(norm(k)===alvo) return POSTER_PATOLOGIA[k];
  }
  // casa por palavra-chave principal
  const chaves = {fasci:"/posters/fascite-plantar.jpg",metatars:"/posters/metatarsalgia.jpg",esporao:"/posters/esporao-calcaneo.jpg",calcaneo:"/posters/esporao-calcaneo.jpg",tendinite:"/posters/tendinite-patelar.jpg",patelar:"/posters/tendinite-patelar.jpg",iliotibial:"/posters/banda-iliotibial.jpg",banda:"/posters/banda-iliotibial.jpg",plano:"/posters/pes-planos.jpg",condromalacia:"/posters/condromalacia.jpg",cavo:"/posters/pes-cavos.jpg"};
  for(const c2 of Object.keys(chaves)){ if(alvo.includes(c2)) return chaves[c2]; }
  return null;
}

function ExerciciosPage({paciente}) {
  const pac = paciente || {};
  const prot = pac.patologia ? PROTOCOLOS_FP[pac.patologia] : null;
  const [checks,setChecks] = useState({});
  const [aberto,setAberto] = useState(null);
  const [posterZoom,setPosterZoom] = useState(false);
  const posterUrl = getPosterPatologia(pac.patologia);
  // Exercícios personalizados que a clínica cadastrou para este paciente
  const [persExs,setPersExs] = useState(()=> pac.id ? (LS.read("fp:expers:"+pac.id)||[]) : []);
  useEffect(()=>{ (async()=>{ if(pac.id){ const v=await LS.readAsync("fp:expers:"+pac.id); if(v) setPersExs(v); } })(); },[pac.id]);
  const [persZoom,setPersZoom] = useState(null);
  // Usa exercícios detalhados do infográfico; fallback para lista simples do protocolo
  const exs = (pac.patologia && EXERCICIOS_PACIENTE[pac.patologia])
    ? EXERCICIOS_PACIENTE[pac.patologia]
    : (prot ? prot.exercicios.map(e=>({n:e.split("—")[0].trim(),t:"",s:"",como:e.includes("—")?e.split("—").slice(1).join("—").trim():"",obj:""})) : []);
  const cor = prot?.cor || C.accent;

  if(!pac.patologia && persExs.length===0) return (
    <div style={{padding:20}}>
      <SH title="Meus Exercícios" sub="Programa personalizado"/>
      <Card p={30} style={{textAlign:"center",color:C.muted}}><div style={{fontSize:40,marginBottom:10}}>💪</div>Seus exercícios aparecerão aqui assim que a clínica definir sua patologia.</Card>
    </div>
  );

  // Sem patologia, mas com exercícios personalizados: mostra só os personalizados
  if(!pac.patologia) return (
    <div style={{padding:20,display:"flex",flexDirection:"column",gap:16}}>
      <SH title="Meus Exercícios" sub="Programa personalizado da sua clínica"/>
      <Card hover={false} p={0} style={{overflow:"hidden",border:`1px solid ${C.green}30`}}>
        <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:16}}>⭐</span>
          <span style={{fontSize:13,fontWeight:800}}>Exercícios personalizados da sua clínica</span>
        </div>
        <div style={{padding:16,display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:12}}>
          {persExs.map((ex,i)=>(
            <div key={i} style={{border:`1px solid ${C.border}`,borderRadius:10,overflow:"hidden",background:C.bgGlass}}>
              {ex.img && <div onClick={()=>setPersZoom(ex.img)} style={{cursor:"zoom-in",background:"#000",display:"flex",justifyContent:"center"}}><img src={ex.img} alt={ex.nome} style={{width:"100%",maxHeight:160,objectFit:"cover"}}/></div>}
              <div style={{padding:12}}>
                <div style={{fontSize:13,fontWeight:800,marginBottom:6}}>{ex.nome}</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
                  {ex.series && <span style={{fontSize:10,fontWeight:700,color:C.green,background:`${C.green}14`,padding:"2px 7px",borderRadius:5}}>Séries: {ex.series}</span>}
                  {ex.repeticoes && <span style={{fontSize:10,fontWeight:700,color:C.accent,background:`${C.accent}14`,padding:"2px 7px",borderRadius:5}}>Repetições: {ex.repeticoes}</span>}
                  {ex.tempo && <span style={{fontSize:10,fontWeight:700,color:C.purple,background:`${C.purple}14`,padding:"2px 7px",borderRadius:5}}>Tempo: {ex.tempo}</span>}
                </div>
                {ex.descricao && <div style={{fontSize:11,color:C.sub,lineHeight:1.6,marginBottom:ex.obs?6:0}}>{ex.descricao}</div>}
                {ex.obs && <div style={{fontSize:10,color:C.muted,lineHeight:1.5,fontStyle:"italic"}}>Obs: {ex.obs}</div>}
              </div>
            </div>
          ))}
        </div>
      </Card>
      {persZoom && (
        <div onClick={()=>setPersZoom(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.92)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:16,cursor:"zoom-out"}}>
          <div style={{position:"absolute",top:16,right:20,fontSize:30,color:"#fff",fontWeight:300,cursor:"pointer"}}>×</div>
          <img src={persZoom} alt="" style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain",borderRadius:8}}/>
        </div>
      )}
    </div>
  );

  const feitos = Object.values(checks).filter(Boolean).length;
  const pct = exs.length ? Math.round((feitos/exs.length)*100) : 0;

  return (
    <div style={{padding:20,display:"flex",flexDirection:"column",gap:16}}>
      <SH title="Meus Exercícios" sub={`Protocolo para ${pac.patologia}`}/>

      {/* Cabeçalho premium estilo infográfico */}
      <Card hover={false} p={0} style={{overflow:"hidden",border:`1px solid ${cor}30`}}>
        <div style={{padding:"18px 20px",background:`linear-gradient(135deg,${cor}18,${cor}06)`,borderBottom:`1px solid ${cor}20`}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:48,height:48,borderRadius:13,background:`${cor}20`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:26}}>{prot?.icon||"💪"}</div>
              <div>
                <div style={{fontSize:18,fontWeight:900,textTransform:"uppercase",letterSpacing:".02em"}}>{pac.patologia}</div>
                <div style={{fontSize:11,color:cor,fontWeight:700,textTransform:"uppercase"}}>Exercícios de fortalecimento e alongamentos</div>
              </div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:22,fontWeight:900,color:cor}}>{feitos}/{exs.length}</div>
              <div style={{fontSize:10,color:C.muted}}>concluídos hoje</div>
            </div>
          </div>
          <div style={{marginTop:14,height:6,background:C.border,borderRadius:99,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${pct}%`,background:`linear-gradient(90deg,${cor},${C.purple})`,borderRadius:99,transition:"width .5s"}}/>
          </div>
        </div>
        <div style={{padding:"10px 20px",display:"flex",alignItems:"center",gap:8,fontSize:11,color:C.amber,background:`${C.amber}08`}}>
          <span>⚠️</span> Realize os exercícios diariamente e respeite seus limites. Em caso de dor intensa, consulte seu fisioterapeuta.
        </div>
      </Card>

      {/* Pôster oficial FisioPiede da patologia */}
      {posterUrl && (
        <Card hover={false} p={0} style={{overflow:"hidden",border:`1px solid ${cor}30`}}>
          <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:16}}>🖼️</span>
              <span style={{fontSize:13,fontWeight:800}}>Guia visual de exercícios — {pac.patologia}</span>
            </div>
            <span style={{fontSize:10,color:C.muted}}>Toque na imagem para ampliar</span>
          </div>
          <div onClick={()=>setPosterZoom(true)} style={{cursor:"zoom-in",background:"#000",display:"flex",justifyContent:"center"}}>
            <img src={posterUrl} alt={`Exercícios para ${pac.patologia}`} style={{width:"100%",maxWidth:1100,height:"auto",display:"block"}}/>
          </div>
        </Card>
      )}

      {/* Modal de zoom do pôster */}
      {posterZoom && posterUrl && (
        <div onClick={()=>setPosterZoom(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.92)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:16,cursor:"zoom-out"}}>
          <div style={{position:"absolute",top:16,right:20,fontSize:30,color:"#fff",fontWeight:300,cursor:"pointer"}}>×</div>
          <img src={posterUrl} alt={pac.patologia} style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain",borderRadius:8}}/>
        </div>
      )}

      {/* Exercícios personalizados da clínica */}
      {persExs.length>0 && (
        <Card hover={false} p={0} style={{overflow:"hidden",border:`1px solid ${C.green}30`,marginTop:14}}>
          <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:16}}>⭐</span>
            <span style={{fontSize:13,fontWeight:800}}>Exercícios personalizados da sua clínica</span>
          </div>
          <div style={{padding:16,display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:12}}>
            {persExs.map((ex,i)=>(
              <div key={i} style={{border:`1px solid ${C.border}`,borderRadius:10,overflow:"hidden",background:C.bgGlass}}>
                {ex.img && <div onClick={()=>setPersZoom(ex.img)} style={{cursor:"zoom-in",background:"#000",display:"flex",justifyContent:"center"}}><img src={ex.img} alt={ex.nome} style={{width:"100%",maxHeight:160,objectFit:"cover"}}/></div>}
                <div style={{padding:12}}>
                  <div style={{fontSize:13,fontWeight:800,marginBottom:6}}>{ex.nome}</div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
                    {ex.series && <span style={{fontSize:10,fontWeight:700,color:C.green,background:`${C.green}14`,padding:"2px 7px",borderRadius:5}}>Séries: {ex.series}</span>}
                    {ex.repeticoes && <span style={{fontSize:10,fontWeight:700,color:C.accent,background:`${C.accent}14`,padding:"2px 7px",borderRadius:5}}>Repetições: {ex.repeticoes}</span>}
                    {ex.tempo && <span style={{fontSize:10,fontWeight:700,color:C.purple,background:`${C.purple}14`,padding:"2px 7px",borderRadius:5}}>Tempo: {ex.tempo}</span>}
                  </div>
                  {ex.descricao && <div style={{fontSize:11,color:C.sub,lineHeight:1.6,marginBottom:ex.obs?6:0}}>{ex.descricao}</div>}
                  {ex.obs && <div style={{fontSize:10,color:C.muted,lineHeight:1.5,fontStyle:"italic"}}>Obs: {ex.obs}</div>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Modal de zoom de exercício personalizado */}
      {persZoom && (
        <div onClick={()=>setPersZoom(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.92)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:16,cursor:"zoom-out"}}>
          <div style={{position:"absolute",top:16,right:20,fontSize:30,color:"#fff",fontWeight:300,cursor:"pointer"}}>×</div>
          <img src={persZoom} alt="" style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain",borderRadius:8}}/>
        </div>
      )}

      {/* Grid de exercícios estilo infográfico */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:12}}>
        {exs.map((ex,i)=>{const done=checks[i];return(
          <Card key={i} p={0} style={{overflow:"hidden",border:`1px solid ${done?C.green+"40":cor+"20"}`,background:done?`${C.green}06`:C.bgCard,transition:"all .2s"}}>
            <div style={{padding:16}}>
              <div style={{display:"flex",alignItems:"flex-start",gap:12,marginBottom:12}}>
                <div style={{width:34,height:34,borderRadius:9,background:`${cor}18`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:900,color:cor,flexShrink:0}}>{String(i+1).padStart(2,"0")}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:800,fontSize:13,lineHeight:1.3,textTransform:"uppercase",letterSpacing:".01em"}}>{ex.n}</div>
                </div>
                <button onClick={()=>setChecks(p=>({...p,[i]:!p[i]}))} style={{width:28,height:28,borderRadius:"50%",background:done?C.green:`${cor}12`,color:done?"#fff":cor,border:`2px solid ${done?C.green:cor+"30"}`,fontSize:13,fontWeight:900,cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>{done?"✓":""}</button>
              </div>
              {(ex.t||ex.s)&&(
                <div style={{display:"flex",gap:16,marginBottom:12,paddingBottom:12,borderBottom:`1px solid ${C.border}`}}>
                  {ex.t&&<div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:14}}>⏱️</span><div><div style={{fontSize:13,fontWeight:800}}>{ex.t}</div><div style={{fontSize:9,color:C.muted,textTransform:"uppercase"}}>tempo/rep</div></div></div>}
                  {ex.s&&<div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:14}}>🔁</span><div><div style={{fontSize:13,fontWeight:800}}>{ex.s}</div><div style={{fontSize:9,color:C.muted,textTransform:"uppercase"}}>séries</div></div></div>}
                </div>
              )}
              {ex.como&&(
                <div style={{marginBottom:ex.obj?10:0}}>
                  <div style={{fontSize:9,color:cor,fontWeight:800,textTransform:"uppercase",marginBottom:3}}>Como fazer</div>
                  <div style={{fontSize:12,color:C.sub,lineHeight:1.6}}>{ex.como}</div>
                </div>
              )}
              {ex.obj&&(
                <div style={{padding:"8px 10px",background:`${cor}08`,borderRadius:8,border:`1px solid ${cor}18`}}>
                  <div style={{fontSize:9,color:cor,fontWeight:800,textTransform:"uppercase",marginBottom:2}}>Objetivo</div>
                  <div style={{fontSize:11,color:C.sub,lineHeight:1.5}}>{ex.obj}</div>
                </div>
              )}
            </div>
          </Card>
        );})}
      </div>

      {/* Rodapé motivacional */}
      <Card hover={false} p={16} style={{background:`linear-gradient(135deg,${cor}10,${C.purple}06)`,border:`1px solid ${cor}20`,textAlign:"center"}}>
        <div style={{fontSize:13,fontWeight:800,color:cor}}>📅 CONSISTÊNCIA É O CAMINHO PARA A RECUPERAÇÃO!</div>
        <div style={{fontSize:11,color:C.muted,marginTop:4}}>A regularidade é essencial para melhores resultados.</div>
      </Card>
    </div>
  );
}

// 🔐 COFRE DE SENHAS — nunca guardamos a senha em si, só a "impressão digital" dela
// (hash SHA-256 + sal único por usuário). Registros antigos em texto puro continuam
// funcionando no login (formato legado) até serem blindados pelo botão na Fundação.
const SENHA_FP = {
  sal: () => Math.random().toString(36).slice(2) + Date.now().toString(36),
  hash: async (senha, sal) => {
    const dados = new TextEncoder().encode(`fp§${sal}§${senha}`);
    const buf = await crypto.subtle.digest("SHA-256", dados);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  },
  // Gera as credenciais para gravar no cadastro (sem a senha em texto!)
  criar: async (senha) => {
    const sal = SENHA_FP.sal();
    return { senhaHash: await SENHA_FP.hash(senha, sal), senhaSal: sal };
  },
  // Confere uma senha digitada contra um cadastro (novo formato OU legado)
  conferir: async (senha, reg) => {
    try {
      if (reg && reg.senhaHash && reg.senhaSal) {
        if (!(globalThis.crypto && crypto.subtle)) return false;
        return (await SENHA_FP.hash(senha, reg.senhaSal)) === reg.senhaHash;
      }
      if (reg && typeof reg.senha === "string" && reg.senha) return reg.senha === senha; // formato antigo
    } catch (e) {}
    return false;
  },
};

function FundacaoCard() {
  const [linhas, setLinhas] = useState(null);
  const [rodando, setRodando] = useState(false);

  const NOMES = { "fp:clinicas":"Clínicas", "fp:pacientes":"Pacientes", "fp:consultas":"Consultas", "fp:pedidos":"Pedidos" };

  const testar = async () => {
    setRodando(true); setLinhas([{txt:"Verificando as tabelas...",cor:C.muted}]);
    const out = [];
    for (const key of Object.keys(TABELAS.mapa)) {
      const t = TABELAS.mapa[key].tabela;
      const r = await TABELAS.contar(t);
      const antigo = await DB.get(key);
      const qAntigo = Array.isArray(antigo) ? antigo.length : 0;
      if (!r.ok) out.push({ txt: `${NOMES[key]}: ⚠️ tabela inacessível (${r.erro})`, cor: C.amber });
      else if ((r.total||0) === 0 && qAntigo > 0) out.push({ txt: `${NOMES[key]}: tabela vazia · ${qAntigo} registros aguardando migração`, cor: C.amber });
      else out.push({ txt: `${NOMES[key]}: ✅ ${r.total ?? "?"} na tabela nova${qAntigo?` (formato antigo: ${qAntigo})`:""}`, cor: C.green });
    }
    setLinhas(out); setRodando(false);
  };

  // 🔐 Converte todas as senhas em texto puro para impressão digital (hash + sal)
  const blindarSenhas = async () => {
    setRodando(true); setLinhas([{txt:"Blindando as senhas...",cor:C.muted}]);
    const out = [];
    const alvos = [["fp:clinicas","Clínicas"],["fp:pacientes","Pacientes"],["fp:colaboradores","Colaboradores"]];
    for (const [key, nome] of alvos) {
      try {
        let lista = await LS.readAsync(key);
        if (!Array.isArray(lista)) lista = LS.read(key) || [];
        if (!Array.isArray(lista) || lista.length === 0) { out.push({ txt: `${nome}: nada para blindar`, cor: C.muted }); continue; }
        let n = 0;
        const nova = [];
        for (const r of lista) {
          if (r && typeof r.senha === "string" && r.senha) {
            const cred = await SENHA_FP.criar(r.senha);
            const nx = { ...r, ...cred }; delete nx.senha;
            nova.push(nx); n++;
          } else nova.push(r);
        }
        if (n > 0) LS.write(key, nova);
        out.push({ txt: `${nome}: ${n>0 ? `✅ ${n} senha(s) criptografada(s)` : "✅ já protegidas"}`, cor: C.green });
      } catch (e) { out.push({ txt: `${nome}: ⚠️ erro ao blindar`, cor: C.amber }); }
    }
    out.push({ txt: "Senhas agora são guardadas como impressão digital — nem o banco conhece o texto. Recarregue (F5).", cor: C.sub });
    setLinhas(out); setRodando(false);
  };

  const migrar = async () => {
    setRodando(true); setLinhas([{txt:"Migrando para as tabelas de verdade...",cor:C.muted}]);
    TABELAS.ok = {}; TABELAS.migrada = {};  // limpa qualquer "modo antigo" preso da sessão
    const out = [];
    for (const key of Object.keys(TABELAS.mapa)) {
      const t = TABELAS.mapa[key].tabela;
      try {
        const antigo = await DB.get(key);
        if (!Array.isArray(antigo) || antigo.length === 0) { out.push({ txt: `${NOMES[key]}: nada para migrar`, cor: C.muted }); continue; }
        const okG = await TABELAS.gravar(key, antigo);
        const dep = await TABELAS.contar(t);
        if (okG && dep.ok) out.push({ txt: `${NOMES[key]}: ✅ ${dep.total ?? antigo.length} registros na tabela nova`, cor: C.green });
        else out.push({ txt: `${NOMES[key]}: ⚠️ falhou (${dep.erro || "envio recusado"})`, cor: C.amber });
      } catch (e) { out.push({ txt: `${NOMES[key]}: ⚠️ erro inesperado`, cor: C.amber }); }
    }
    out.push({ txt: "Pronto! Recarregue a página (F5) para o app usar as tabelas.", cor: C.sub });
    setLinhas(out); setRodando(false);
  };

  return (
    <Card p={20} style={{ border: `1px solid ${C.purple}30`, background: `${C.purple}06`, marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 14, color: C.purple }}>🏗️ Fundação — banco de verdade</div>
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 3, lineHeight: 1.5, maxWidth: 460 }}>Verifique se as tabelas novas (clínicas, pacientes, consultas, pedidos) estão recebendo os dados — e migre manualmente se precisar.</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn v="ghost" sz="sm" disabled={rodando} onClick={testar}>🩺 Testar</Btn>
          <Btn v="ghost" sz="sm" disabled={rodando} onClick={blindarSenhas}>🔐 Blindar senhas</Btn>
          <Btn v="primary" sz="sm" disabled={rodando} onClick={migrar} style={{ background: C.purple }}>{rodando ? "Aguarde..." : "🚚 Migrar agora"}</Btn>
        </div>
      </div>
      {linhas && (
        <div style={{ marginTop: 12, padding: "10px 13px", background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 8, display: "flex", flexDirection: "column", gap: 5 }}>
          {linhas.map((l, i) => <div key={i} style={{ fontSize: 11.5, color: l.cor, fontWeight: 600 }}>{l.txt}</div>)}
        </div>
      )}
    </Card>
  );
}

function BackupCard() {
  const [baixando, setBaixando] = useState(false);
  const [restaurando, setRestaurando] = useState(false);
  const [msg, setMsg] = useState("");
  const [ultimo, setUltimo] = useState(() => LS.read("fp:ultimoBackup") || null);
  const restoreRef = useRef(null);

  // ⏮️ Restaura um arquivo de backup (substitui as chaves presentes no arquivo)
  const restaurarBackup = (e) => {
    const file = e.target && e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const dump = JSON.parse(reader.result);
        const dados = { ...(dump.dados || {}), ...(dump.arquivos || {}) };
        const n = Object.keys(dados).length;
        if (!n) { setMsg("⚠️ Este arquivo não parece um backup do FisioPiede."); return; }
        const quando = dump._data ? new Date(dump._data).toLocaleString("pt-BR") : "data desconhecida";
        if (!window.confirm(`Restaurar ${n} registros do backup de ${quando}?\n\n⚠️ Os dados atuais com as mesmas chaves serão SUBSTITUÍDOS (no aparelho e na nuvem). Esta ação não pode ser desfeita.`)) { setMsg("Restauração cancelada."); return; }
        setRestaurando(true);
        let ok = 0;
        for (const [k, v] of Object.entries(dados)) {
          if (v === null || v === undefined) continue;
          try { LS.write(k, v); ok++; } catch (err) {}
        }
        setRestaurando(false);
        setMsg(`✓ ${ok} registros restaurados! Recarregue a página (F5) para ver os dados de volta.`);
      } catch (err) {
        setMsg("⚠️ Não consegui ler este arquivo. Confirme que é um backup .json do FisioPiede.");
      }
      if (restoreRef.current) restoreRef.current.value = "";
    };
    reader.readAsText(file);
  };

  const fazerBackup = async () => {
    setBaixando(true); setMsg("Reunindo os dados...");
    try {
      const dump = { _info: "Backup FisioPiede (total)", _data: new Date().toISOString(), dados: {} };
      // ☁️ 1) NUVEM INTEIRA: todas as linhas da tabela app_data, de uma vez só.
      // Isso garante que NADA fica de fora: chat, notificações, colaboradores, cotas de IA, tudo.
      let nuvemOk = false;
      if (useBackend) {
        try {
          const r = await fetch(`${BACKEND.url}/rest/v1/app_data?select=chave,valor`, { headers: DB.headers() });
          if (r.ok) {
            const rows = await r.json();
            for (const row of (rows||[])) dump.dados[row.chave] = row.valor;
            nuvemOk = true;
            setMsg(`Nuvem lida: ${(rows||[]).length} registros. Completando com dados locais...`);
          }
        } catch (e) {}
      }
      // 📱 2) Completa com o que só existe NESTE aparelho (localStorage fp:*)
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.indexOf("fp:") === 0 && !(k in dump.dados)) {
            try { dump.dados[k] = JSON.parse(localStorage.getItem(k)); } catch (e) {}
          }
        }
      } catch (e) {}
      // 🛟 3) Se a nuvem não respondeu, garante o essencial pelo caminho antigo
      if (!nuvemOk) {
        const chaves = ["fp:clinicas", "fp:pacientes", "fp:consultas", "fp:solicitacoes", "fp:pagamentos", "fp:pedidos", "fp:pedidos:del", "fp:colaboradores"];
        for (const k of chaves) {
          if (k in dump.dados) continue;
          try { dump.dados[k] = await LS.readAsync(k); } catch (e) { dump.dados[k] = null; }
        }
        const peds = dump.dados["fp:pedidos"] || [];
        for (const p of peds) {
          try { const arq = await LS.readAsync("fp:arq:" + p.id); if (arq) dump.dados["fp:arq:" + p.id] = arq; } catch (e) {}
        }
        for (const pac of (dump.dados["fp:pacientes"] || [])) {
          try { const dor = await LS.readAsync("fp:dor:" + pac.id); if (dor) { dump.dados["fp:dor:" + pac.id] = dor; } } catch (e) {}
        }
      }
      dump._total = Object.keys(dump.dados).length;
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const hoje = new Date().toISOString().split("T")[0];
      a.href = url; a.download = `backup-fisiopiede-${hoje}.json`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      const agora = new Date().toLocaleString("pt-BR");
      LS.write("fp:ultimoBackup", agora); LS.write("fp:ultimoBackupISO", new Date().toISOString()); setUltimo(agora);
      setMsg(`✓ Backup total baixado (${dump._total} registros)! Guarde o arquivo em local seguro (computador + nuvem).`);
    } catch (e) {
      setMsg("Não foi possível gerar o backup agora. Tente novamente.");
    }
    setBaixando(false);
  };

  return (
    <Card p={20} style={{ border: `1px solid ${C.green}30`, background: `${C.green}06`, marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 14, color: C.green }}>💾 Backup dos dados</div>
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 3, lineHeight: 1.5, maxWidth: 460 }}>Baixe uma cópia de segurança TOTAL: tudo que está na nuvem (clínicas, pacientes, pedidos, conversas, notificações, cotas) + dados deste aparelho. Se algo der errado um dia, o botão Restaurar traz tudo de volta.</div>
          {ultimo && <div style={{ fontSize: 10.5, color: C.muted, marginTop: 5 }}>Último backup: <strong>{ultimo}</strong></div>}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn v="primary" disabled={baixando} onClick={fazerBackup} style={{ background: C.green }}>{baixando ? "Gerando..." : "💾 Baixar backup agora"}</Btn>
          <input ref={restoreRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={restaurarBackup} />
          <Btn v="ghost" disabled={restaurando} onClick={() => restoreRef.current && restoreRef.current.click()}>{restaurando ? "Restaurando..." : "⏮️ Restaurar backup"}</Btn>
        </div>
      </div>
      {msg && <div style={{ marginTop: 12, padding: "9px 13px", background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11.5, color: C.sub }}>{msg}</div>}
      <div style={{ marginTop: 10, fontSize: 10, color: C.muted, fontStyle: "italic" }}>Dica: faça um backup ao menos uma vez por semana, ou após cadastrar muitas informações novas.</div>
    </Card>
  );
}

function ConfigPage({userType, paciente, clinicaId}) {
  // Perfil do paciente
  if(userType==="paciente" && paciente){
    const p = paciente;
    const prot = p.patologia ? PROTOCOLOS_FP[p.patologia] : null;
    const endereco = [p.rua,p.numero,p.complemento,p.bairro,p.cidade,p.estado].filter(Boolean).join(", ");
    return (
      <div style={{padding:20,display:"flex",flexDirection:"column",gap:16}}>
        <SH title="Meu Perfil" sub="Seus dados cadastrais"/>
        <Card hover={false} p={24} style={{background:`linear-gradient(135deg,${C.accent}08,${C.purple}05)`,border:`1px solid ${C.accent}20`}}>
          <div style={{display:"flex",alignItems:"center",gap:16}}>
            <div style={{width:64,height:64,borderRadius:18,background:`linear-gradient(135deg,${C.accent},${C.purple})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,fontWeight:900,color:"#fff"}}>{(p.nome||"?").charAt(0)}</div>
            <div>
              <div style={{fontSize:20,fontWeight:900}}>{p.nome} {p.sobrenome}</div>
              <div style={{fontSize:12,color:C.muted}}>{p.clinica||"—"}</div>
              {prot&&<div style={{marginTop:5}}><Badge label={`${prot.icon} ${p.patologia}`} color={prot.cor}/></div>}
            </div>
          </div>
        </Card>
        <Card p={20}>
          <div style={{fontSize:11,color:C.accent,fontWeight:700,textTransform:"uppercase",marginBottom:14}}>▸ Dados Pessoais</div>
          <div style={{display:"flex",flexDirection:"column",gap:0}}>
            {[["Nome completo",`${p.nome||""} ${p.sobrenome||""}`],["WhatsApp",p.whatsapp||"—"],["E-mail",p.email||"—"],["Endereço",endereco||"—"],["CEP",p.cep||"—"],["Data de Retorno",p.dataRetorno?p.dataRetorno.split("-").reverse().join("/"):"—"]].map(([l,v])=>(
              <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"11px 0",borderBottom:`1px solid ${C.border}`,fontSize:13,gap:12}}>
                <span style={{color:C.muted,flexShrink:0}}>{l}</span>
                <span style={{fontWeight:600,textAlign:"right"}}>{v}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card p={16} style={{background:`${C.accent}05`,border:`1px solid ${C.accent}16`}}>
          <div style={{fontSize:11,color:C.muted,lineHeight:1.6}}>Para alterar seus dados, entre em contato com sua clínica. FisioPiede · LGPD Compliant.</div>
        </Card>
      </div>
    );
  }
  return (
    <div style={{padding:20}}>
      <SH title="Configurações" sub="Personalização e preferências"/>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:16}}>
        {[["👤","Perfil","Nome, foto, senha e dados pessoais"],["🔔","Notificações","E-mail, WhatsApp e alertas"],["🔒","Segurança","2FA, sessões ativas e auditoria"],["⚡","Integrações","WhatsApp API, Correios, Gateway"],["🎨","Aparência","Tema, cores e layout"],["🛡️","LGPD","Gestão de dados e consentimentos"]].map(([icon,t,d],i)=>(
          <Card key={i} p={18}><div style={{fontSize:26,marginBottom:10}}>{icon}</div><div style={{fontWeight:800,fontSize:13,marginBottom:5}}>{t}</div><div style={{fontSize:11,color:C.muted,lineHeight:1.5}}>{d}</div></Card>
        ))}
      </div>
      {userType==="clinica" && <ColaboradoresManager clinicaId={clinicaId}/>}
      {userType==="admin" && <><FundacaoCard/><BackupCard/></>}
      <Card p={16} style={{background:`${C.accent}05`,border:`1px solid ${C.accent}16`,marginTop:16}}>
        <div style={{fontWeight:800,marginBottom:3}}>FisioPiede Platform v2.0</div>
        <div style={{fontSize:11,color:C.muted}}>Valor por pedido: <strong style={{color:C.green}}>R$ {brl(PRECO)}</strong> · LGPD Compliant · {userType==="admin"?"Admin Master":userType==="clinica"?"Clínica Licenciada":"Paciente"}</div>
      </Card>
    </div>
  );
}


// ══════════════════════════════════════════════════════════════════════════════
// FISIOPIEDE ACADEMY — Componente principal
// ══════════════════════════════════════════════════════════════════════════════
function AcademyPage({ userName, userType, clinicaName, clinicaId, planoIA }) {
  const userKey = "fp:academy:" + (userName || "user").replace(/\s/g, "_");
  const [aba, setAba] = useState("dashboard");
  const [cursoAberto, setCursoAberto] = useState(null);
  const [aulaAtual, setAulaAtual] = useState(null);   // {mi, ai}
  const [emProva, setEmProva] = useState(false);
  const [provaResp, setProvaResp] = useState({});
  const [provaResult, setProvaResult] = useState(null);
  const [certAberto, setCertAberto] = useState(null);
  const [livroAberto, setLivroAberto] = useState(null);
  const [capAtual, setCapAtual] = useState(0);
  const [tutorMsgs, setTutorMsgs] = useState([]);
  const [tutorInput, setTutorInput] = useState("");
  const [tutorLoading, setTutorLoading] = useState(false);

  // Progresso persistido
  const [prog, _setProg] = useState(() => LS.read(userKey) || { aulas: {}, cursos: {}, certificados: [], xp: 0 });
  useEffect(() => { (async () => { const p = await LS.readAsync(userKey); if (p) _setProg(p); })(); }, []);
  const setProg = (u) => _setProg(p => { const n = typeof u === "function" ? u(p) : u; LS.write(userKey, n); return n; });

  const nivel = nivelDe(prog.xp);
  const prox = proxNivel(prog.xp);
  const cursosFeitos = Object.keys(prog.cursos).filter(id => prog.cursos[id]?.concluido).length;
  const horasTotais = ACADEMY_CURSOS.filter(c => prog.cursos[c.id]?.concluido).reduce((a, c) => a + c.horas, 0);

  const aulaKey = (cid, mi, ai) => `${cid}:${mi}:${ai}`;
  const aulaFeita = (cid, mi, ai) => !!prog.aulas[aulaKey(cid, mi, ai)];
  const totalAulas = (c) => c.modulos.reduce((a, m) => a + m.aulas.length, 0);
  const aulasFeitasCurso = (c) => c.modulos.reduce((a, m, mi) => a + m.aulas.filter((_, ai) => aulaFeita(c.id, mi, ai)).length, 0);
  const pctCurso = (c) => Math.round((aulasFeitasCurso(c) / totalAulas(c)) * 100);

  const marcarAula = (cid, mi, ai) => {
    const k = aulaKey(cid, mi, ai);
    if (prog.aulas[k]) return;
    setProg(p => ({ ...p, aulas: { ...p.aulas, [k]: Date.now() }, xp: p.xp + 10 }));
  };

  const concluirCurso = (curso, nota) => {
    const codigo = "FP-" + curso.id.toUpperCase().slice(0, 4) + "-" + Date.now().toString().slice(-6);
    setProg(p => {
      if (p.cursos[curso.id]?.concluido) return p;
      const cert = { id: codigo, curso: curso.titulo, horas: curso.horas, nota, data: new Date().toISOString(), nome: userName };
      return {
        ...p,
        cursos: { ...p.cursos, [curso.id]: { concluido: true, nota, data: Date.now() } },
        certificados: [...p.certificados, cert],
        xp: p.xp + 100 + (nota >= 70 ? 50 : 0),
      };
    });
  };

  function abrirCurso(c) { setCursoAberto(c); setAulaAtual(null); setEmProva(false); setProvaResult(null); setProvaResp({}); }
  function abrirAula(mi, ai) { setAulaAtual({ mi, ai }); setEmProva(false); }

  function enviarProva() {
    const total = cursoAberto.prova.length;
    let acertos = 0;
    cursoAberto.prova.forEach((q, i) => { if (provaResp[i] === q.correta) acertos++; });
    const nota = Math.round((acertos / total) * 100);
    setProvaResult({ nota, acertos, total });
    if (nota >= 70) concluirCurso(cursoAberto, nota);
  }

  // Base de conhecimento local — busca nos cursos e protocolos do próprio sistema
  function buscarConhecimentoLocal(pergunta) {
    const q = pergunta.toLowerCase().replace(/[^a-zà-ú0-9\s]/gi, " ");
    const palavras = q.split(/\s+/).filter(w => w.length > 3);
    const candidatos = [];
    // Indexa aulas dos cursos
    ACADEMY_CURSOS.forEach(c => c.modulos.forEach(m => m.aulas.forEach(a => {
      const texto = (a.t + " " + a.txt).toLowerCase();
      let score = 0;
      palavras.forEach(w => { if (texto.includes(w)) score += (a.t.toLowerCase().includes(w) ? 3 : 1); });
      if (score > 0) candidatos.push({ score, titulo: a.t, conteudo: a.txt, fonte: c.titulo });
    })));
    // Indexa protocolos de patologias
    Object.entries(PROTOCOLOS_FP).forEach(([nome, p]) => {
      const texto = (nome + " " + p.definicao + " " + p.sintomas + " " + p.tratamento + " " + (p.palmilha?.elementos || "")).toLowerCase();
      let score = 0;
      palavras.forEach(w => { if (texto.includes(w)) score += (nome.toLowerCase().includes(w) ? 3 : 1); });
      if (score > 0) candidatos.push({ score, titulo: nome, conteudo: `${p.definicao} Sintomas: ${p.sintomas} Palmilha indicada: ${p.palmilha?.elementos || "—"}. Tratamento: ${p.tratamento}`, fonte: "Protocolos FisioPiede" });
    });
    candidatos.sort((a, b) => b.score - a.score);
    return candidatos[0] || null;
  }

  async function perguntarTutor() {
    if (!tutorInput.trim()) return;
    const pergunta = tutorInput.trim();
    setTutorMsgs(m => [...m, { de: "user", txt: pergunta }]);
    setTutorInput(""); setTutorLoading(true);
    const permIA = podeUsarIA(clinicaId, planoIA);
    if (!permIA.ok) {
      // Sem IA disponível: responde com o conhecimento local da apostila
      const local = (typeof buscarConhecimentoLocal === "function") ? buscarConhecimentoLocal(pergunta) : null;
      setTutorMsgs(m => [...m, { de: "bot", txt: (local || permIA.msg) }]);
      setTutorLoading(false);
      return;
    }

    let respondido = false;
    // 1) Tenta a IA (resposta conversacional natural)
    try {
      const ctx = cursoAberto ? `O aluno está no curso "${cursoAberto.titulo}". ` : "";
      const res = await fetch("/api/ia", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-opus-4-7", max_tokens: 1000,
          messages: [{ role: "user", content: `Você é o tutor educacional da FisioPiede Academy, especialista em posturologia, baropodometria, biomecânica e palmilhas posturais. ${ctx}Responda de forma didática, clara e concisa (máx 150 palavras) à dúvida do aluno: ${pergunta}` }],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const txt = (data.content || []).map(b => b.text || "").join("").trim();
        if (txt) { setTutorMsgs(m => [...m, { de: "ia", txt }]); respondido = true; }
      }
    } catch (e) { /* cai para base local */ }

    // 2) Fallback: base de conhecimento local (sempre funciona)
    if (!respondido) {
      const found = buscarConhecimentoLocal(pergunta);
      if (found) {
        setTutorMsgs(m => [...m, { de: "ia", txt: `${found.conteudo}\n\n📚 Fonte: ${found.fonte} — "${found.titulo}"` }]);
      } else {
        setTutorMsgs(m => [...m, { de: "ia", txt: "Não encontrei esse tópico na base FisioPiede. Tente perguntar sobre: baropodometria, centro de pressão, posturologia, footcore, fascite plantar, palmilhas, ou outra patologia/conceito dos cursos." }]);
      }
    }
    setTutorLoading(false);
  }

  // ─── VISÃO: CURSO ABERTO ───────────────────────────────────────────────
  if (cursoAberto) {
    const c = cursoAberto;
    const aula = aulaAtual ? c.modulos[aulaAtual.mi].aulas[aulaAtual.ai] : null;
    return (
      <div style={{ padding: 20 }}>
        <button onClick={() => setCursoAberto(null)} style={{ background: "none", color: C.muted, fontSize: 12, marginBottom: 12, display: "flex", alignItems: "center", gap: 5 }}>← Voltar à Academy</button>
        <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 16 }}>
          {/* Sidebar de módulos */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Card hover={false} p={16} style={{ background: `linear-gradient(135deg,${c.cor}12,${c.cor}04)`, border: `1px solid ${c.cor}25` }}>
              <div style={{ fontSize: 28, marginBottom: 6 }}>{c.icon}</div>
              <div style={{ fontWeight: 800, fontSize: 14 }}>{c.titulo}</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{c.horas}h · {c.nivel}</div>
              <div style={{ marginTop: 10, height: 5, background: C.border, borderRadius: 99, overflow: "hidden" }}><div style={{ height: "100%", width: `${pctCurso(c)}%`, background: `linear-gradient(90deg,${c.cor},${C.purple})`, borderRadius: 99 }} /></div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>{pctCurso(c)}% concluído</div>
            </Card>
            {c.modulos.map((m, mi) => (
              <Card key={mi} hover={false} p={12}>
                <div style={{ fontSize: 11, fontWeight: 800, color: c.cor, marginBottom: 8, textTransform: "uppercase" }}>Módulo {mi + 1}: {m.titulo}</div>
                {m.aulas.map((a, ai) => {
                  const done = aulaFeita(c.id, mi, ai), atual = aulaAtual && aulaAtual.mi === mi && aulaAtual.ai === ai;
                  return (
                    <button key={ai} onClick={() => abrirAula(mi, ai)} style={{ width: "100%", textAlign: "left", padding: "7px 9px", borderRadius: 7, background: atual ? `${c.cor}15` : "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 7, marginBottom: 2 }}>
                      <span style={{ width: 16, height: 16, borderRadius: "50%", background: done ? C.green : `${c.cor}20`, color: done ? "#fff" : c.cor, fontSize: 8, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{done ? "✓" : ai + 1}</span>
                      <span style={{ fontSize: 11, color: atual ? c.cor : C.sub, fontWeight: atual ? 700 : 400, lineHeight: 1.3 }}>{a.t}</span>
                    </button>
                  );
                })}
              </Card>
            ))}
            <Card hover={false} p={12} style={{ border: `1px solid ${pctCurso(c) === 100 ? C.green + "40" : C.border}` }}>
              <button onClick={() => { setEmProva(true); setAulaAtual(null); setProvaResult(null); }} disabled={pctCurso(c) < 100} style={{ width: "100%", padding: "9px", borderRadius: 8, background: pctCurso(c) === 100 ? c.cor : C.border, color: pctCurso(c) === 100 ? "#fff" : C.muted, border: "none", fontWeight: 700, fontSize: 12, cursor: pctCurso(c) === 100 ? "pointer" : "not-allowed" }}>
                {prog.cursos[c.id]?.concluido ? "✓ Curso Concluído" : pctCurso(c) === 100 ? "📝 Fazer Prova Final" : "🔒 Complete as aulas"}
              </button>
            </Card>
          </div>

          {/* Conteúdo */}
          <div>
            {emProva ? (
              <Card hover={false} p={24}>
                <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 4 }}>📝 Prova Final — {c.titulo}</div>
                <div style={{ fontSize: 12, color: C.muted, marginBottom: 18 }}>Acerte 70% para ser aprovado e receber o certificado.</div>
                {provaResult ? (
                  <div style={{ textAlign: "center", padding: 20 }}>
                    <div style={{ fontSize: 50, marginBottom: 10 }}>{provaResult.nota >= 70 ? "🎉" : "📚"}</div>
                    <div style={{ fontSize: 28, fontWeight: 900, color: provaResult.nota >= 70 ? C.green : C.amber }}>{provaResult.nota}%</div>
                    <div style={{ fontSize: 13, color: C.sub, marginTop: 6 }}>{provaResult.acertos} de {provaResult.total} corretas</div>
                    <div style={{ fontSize: 13, fontWeight: 700, marginTop: 12, color: provaResult.nota >= 70 ? C.green : C.amber }}>{provaResult.nota >= 70 ? "✓ Aprovado! Certificado emitido." : "Continue estudando e tente novamente."}</div>
                    <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 18 }}>
                      {provaResult.nota >= 70
                        ? <Btn v="primary" onClick={() => { setEmProva(false); setAba("certificados"); setCursoAberto(null); }}>Ver Certificado →</Btn>
                        : <Btn v="primary" onClick={() => { setProvaResult(null); setProvaResp({}); }}>Tentar Novamente</Btn>}
                      <Btn v="ghost" onClick={() => setEmProva(false)}>Voltar</Btn>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    {c.prova.map((q, i) => (
                      <div key={i}>
                        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{i + 1}. {q.q}</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {q.opts.map((o, oi) => (
                            <button key={oi} onClick={() => setProvaResp(p => ({ ...p, [i]: oi }))} style={{ textAlign: "left", padding: "9px 12px", borderRadius: 8, background: provaResp[i] === oi ? `${c.cor}15` : C.bgGlass, border: `1px solid ${provaResp[i] === oi ? c.cor : C.border}`, color: C.sub, fontSize: 12, cursor: "pointer" }}>{o}</button>
                          ))}
                        </div>
                      </div>
                    ))}
                    <Btn v="primary" full disabled={Object.keys(provaResp).length < c.prova.length} onClick={enviarProva}>Enviar Prova</Btn>
                  </div>
                )}
              </Card>
            ) : aula ? (
              <Card hover={false} p={0} style={{ overflow: "hidden" }}>
                {/* Player */}
                <div style={{ width: "100%", aspectRatio: "16/9", background: `linear-gradient(135deg,${c.cor}18,${C.purple}0A)`, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", borderBottom: `1px solid ${c.cor}20` }}>
                  <div style={{ textAlign: "center", zIndex: 1 }}>
                    <div style={{ width: 68, height: 68, borderRadius: "50%", background: `${c.cor}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, margin: "0 auto 10px", color: "#fff", boxShadow: `0 0 30px ${c.cor}50`, cursor: "pointer" }}>▶</div>
                    <div style={{ fontSize: 11, color: C.muted }}>Vídeo-aula FisioPiede</div>
                  </div>
                  <div style={{ position: "absolute", top: 12, left: 14, fontSize: 10, color: C.muted, background: C.bgGlass, padding: "3px 9px", borderRadius: 99, border: `1px solid ${C.border}` }}>Módulo {aulaAtual.mi + 1} · Aula {aulaAtual.ai + 1}</div>
                  {aulaFeita(c.id, aulaAtual.mi, aulaAtual.ai) && <div style={{ position: "absolute", top: 12, right: 14, fontSize: 10, color: "#fff", background: C.green, padding: "3px 9px", borderRadius: 99, fontWeight: 700 }}>✓ Concluída</div>}
                </div>
                {/* Conteúdo */}
                <div style={{ padding: 26 }}>
                  <div style={{ fontSize: 22, fontWeight: 900, marginBottom: 4 }}>{aula.t}</div>
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 18 }}>{c.titulo} · {c.modulos[aulaAtual.mi].titulo}</div>
                  <div style={{ fontSize: 14, color: C.sub, lineHeight: 1.95, textAlign: "justify" }}>{aula.txt}</div>
                  <div style={{ marginTop: 20, padding: "12px 16px", background: `${c.cor}07`, border: `1px solid ${c.cor}18`, borderRadius: 10, fontSize: 12, color: C.sub }}>
                    💡 <strong>Dica do tutor:</strong> Anote os pontos principais e, em caso de dúvida, use o Tutor IA da Academy para aprofundar este tópico.
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 22, justifyContent: "space-between" }}>
                    <Btn v="ghost" sz="sm" disabled={aulaAtual.mi === 0 && aulaAtual.ai === 0} onClick={() => { if (aulaAtual.ai > 0) abrirAula(aulaAtual.mi, aulaAtual.ai - 1); else if (aulaAtual.mi > 0) abrirAula(aulaAtual.mi - 1, c.modulos[aulaAtual.mi - 1].aulas.length - 1); }}>← Anterior</Btn>
                    <Btn v="primary" onClick={() => { marcarAula(c.id, aulaAtual.mi, aulaAtual.ai); const m = c.modulos[aulaAtual.mi]; if (aulaAtual.ai + 1 < m.aulas.length) abrirAula(aulaAtual.mi, aulaAtual.ai + 1); else if (aulaAtual.mi + 1 < c.modulos.length) abrirAula(aulaAtual.mi + 1, 0); else setAulaAtual(null); }}>
                      {aulaFeita(c.id, aulaAtual.mi, aulaAtual.ai) ? "Próxima aula →" : "✓ Concluir e avançar"}
                    </Btn>
                  </div>
                </div>
              </Card>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {/* Banner do curso */}
                <Card hover={false} p={0} style={{ overflow: "hidden" }}>
                  <div style={{ padding: "28px 28px", background: `linear-gradient(135deg,${c.cor}20,${C.purple}0C)`, position: "relative" }}>
                    <div style={{ fontSize: 44, marginBottom: 10 }}>{c.icon}</div>
                    <div style={{ fontSize: 24, fontWeight: 900, marginBottom: 8 }}>{c.titulo}</div>
                    <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.8, maxWidth: 560 }}>{c.desc}</div>
                    <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
                      <Badge label={`⏱️ ${c.horas} horas`} color={c.cor} /><Badge label={`📊 ${c.nivel}`} color={C.purple} /><Badge label={`🎬 ${totalAulas(c)} aulas`} color={C.accent} /><Badge label={`📦 ${c.modulos.length} módulos`} color={C.green} />{c.obrigatorio && <Badge label="⚠️ Obrigatório" color={C.red} />}
                    </div>
                    <div style={{ marginTop: 18 }}>
                      <Btn v="primary" sz="lg" onClick={() => abrirAula(0, 0)} style={{ boxShadow: `0 0 20px ${c.cor}40` }}>{aulasFeitasCurso(c) > 0 ? `▶ Continuar (${pctCurso(c)}%)` : "▶ Iniciar curso"}</Btn>
                    </div>
                  </div>
                </Card>
                {/* Conteúdo programático */}
                <Card hover={false} p={22}>
                  <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 14 }}>📋 Conteúdo programático</div>
                  {c.modulos.map((m, mi) => {
                    const feitasMod = m.aulas.filter((_, ai) => aulaFeita(c.id, mi, ai)).length;
                    const modCompleto = feitasMod === m.aulas.length;
                    return (
                      <div key={mi} style={{ marginBottom: 14 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                          <div style={{ width: 22, height: 22, borderRadius: 6, background: modCompleto ? C.green : `${c.cor}18`, color: modCompleto ? "#fff" : c.cor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 900 }}>{modCompleto ? "✓" : mi + 1}</div>
                          <div style={{ fontWeight: 700, fontSize: 13 }}>{m.titulo}</div>
                          <div style={{ fontSize: 10, color: C.muted, marginLeft: "auto" }}>{feitasMod}/{m.aulas.length}</div>
                        </div>
                        <div style={{ paddingLeft: 30 }}>
                          {m.aulas.map((a, ai) => (
                            <button key={ai} onClick={() => abrirAula(mi, ai)} style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 8, padding: "6px 0", background: "none", border: "none", cursor: "pointer" }}>
                              <span style={{ fontSize: 11, color: aulaFeita(c.id, mi, ai) ? C.green : C.muted }}>{aulaFeita(c.id, mi, ai) ? "✓" : "○"}</span>
                              <span style={{ fontSize: 12, color: C.sub }}>{a.t}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </Card>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── VISÃO PRINCIPAL (com abas) ──────────────────────────────────────────
  const ABAS = [{ id: "dashboard", icon: "⬡", label: "Dashboard" }, { id: "trilhas", icon: "🛤️", label: "Trilhas" }, { id: "biblioteca", icon: "📚", label: "Biblioteca" }, { id: "glossario", icon: "📖", label: "Glossário" }, { id: "certificados", icon: "🎖️", label: "Certificados" }, { id: "ranking", icon: "🏆", label: "Ranking" }, { id: "tutor", icon: "✦", label: "Tutor IA" }];

  return (
    <div style={{ padding: 20 }}>
      <SH title="FisioPiede Academy 🎓" sub="Universidade Corporativa — formação, certificação e excelência clínica" />
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, marginBottom: 20, overflowX: "auto" }}>
        {ABAS.map(a => { const at = aba === a.id; return (
          <button key={a.id} onClick={() => setAba(a.id)} style={{ padding: "10px 18px", fontSize: 13, fontWeight: at ? 700 : 500, color: at ? C.accent : C.muted, background: "none", borderBottom: at ? `2px solid ${C.accent}` : "2px solid transparent", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}><span>{a.icon}</span>{a.label}</button>
        ); })}
      </div>

      {/* DASHBOARD */}
      {aba === "dashboard" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card hover={false} p={22} style={{ background: `linear-gradient(135deg,${nivel.cor}15,${C.purple}06)`, border: `1px solid ${nivel.cor}30` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ width: 56, height: 56, borderRadius: 16, background: `${nivel.cor}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>{nivel.icon}</div>
                <div>
                  <div style={{ fontSize: 11, color: nivel.cor, fontWeight: 700, textTransform: "uppercase" }}>Nível {nivel.nome}</div>
                  <div style={{ fontSize: 20, fontWeight: 900 }}>{userName}</div>
                  <div style={{ fontSize: 11, color: C.muted }}>{prog.xp} XP{prox ? ` · faltam ${prox.min - prog.xp} XP para ${prox.nome}` : " · nível máximo!"}</div>
                </div>
              </div>
              {prox && <div style={{ minWidth: 160 }}><div style={{ height: 6, background: C.border, borderRadius: 99, overflow: "hidden" }}><div style={{ height: "100%", width: `${Math.min(100, ((prog.xp - nivel.min) / (prox.min - nivel.min)) * 100)}%`, background: `linear-gradient(90deg,${nivel.cor},${C.purple})` }} /></div></div>}
            </div>
          </Card>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 11 }}>
            {[["📚", "Cursos concluídos", cursosFeitos], ["⏱️", "Horas de treino", horasTotais + "h"], ["🎖️", "Certificados", prog.certificados.length], ["⭐", "XP total", prog.xp]].map(([i, l, v], idx) => (
              <Card key={idx} p={16} style={{ textAlign: "center" }}><div style={{ fontSize: 22, marginBottom: 6 }}>{i}</div><div style={{ fontSize: 20, fontWeight: 900 }}>{v}</div><div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>{l}</div></Card>
            ))}
          </div>

          <div>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 10 }}>Continue aprendendo</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 12 }}>
              {ACADEMY_CURSOS.map(c => { const pct = pctCurso(c), done = prog.cursos[c.id]?.concluido; return (
                <Card key={c.id} p={0} style={{ overflow: "hidden", border: `1px solid ${done ? C.green + "30" : c.cor + "20"}`, cursor: "pointer" }} onClick={() => abrirCurso(c)}>
                  <div style={{ padding: "16px 16px 12px", background: `linear-gradient(135deg,${c.cor}12,${c.cor}03)` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <span style={{ fontSize: 26 }}>{c.icon}</span>
                      {done ? <Badge label="✓ Concluído" color={C.green} /> : c.obrigatorio ? <Badge label="Obrigatório" color={C.red} /> : <Badge label="Recomendado" color={C.accent} />}
                    </div>
                    <div style={{ fontWeight: 800, fontSize: 14, marginTop: 8, lineHeight: 1.3 }}>{c.titulo}</div>
                    <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>{c.trilha} · {c.horas}h</div>
                  </div>
                  <div style={{ padding: "10px 16px 14px" }}>
                    <div style={{ height: 5, background: C.border, borderRadius: 99, overflow: "hidden", marginBottom: 6 }}><div style={{ height: "100%", width: `${pct}%`, background: `linear-gradient(90deg,${c.cor},${C.purple})`, borderRadius: 99 }} /></div>
                    <div style={{ fontSize: 10, color: C.muted }}>{pct}% · {aulasFeitasCurso(c)}/{totalAulas(c)} aulas</div>
                  </div>
                </Card>
              ); })}
            </div>
          </div>
        </div>
      )}

      {/* TRILHAS */}
      {aba === "trilhas" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 12 }}>
          {ACADEMY_TRILHAS.map((t, i) => { const cursos = t.cursos.map(id => ACADEMY_CURSOS.find(c => c.id === id)).filter(Boolean); const feitos = cursos.filter(c => prog.cursos[c.id]?.concluido).length; return (
            <Card key={i} p={0} style={{ overflow: "hidden", border: `1px solid ${t.cor}20` }}>
              <div style={{ padding: 16, background: `linear-gradient(135deg,${t.cor}12,${t.cor}04)` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 11, background: `${t.cor}20`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>{t.icon}</div>
                  <div><div style={{ fontWeight: 800, fontSize: 13 }}>Trilha {i + 1}</div><div style={{ fontSize: 12, color: t.cor, fontWeight: 700 }}>{t.nome}</div></div>
                </div>
              </div>
              <div style={{ padding: 14 }}>
                {cursos.length > 0 ? cursos.map(c => (
                  <button key={c.id} onClick={() => abrirCurso(c)} style={{ width: "100%", textAlign: "left", padding: "9px 11px", borderRadius: 8, background: C.bgGlass, border: `1px solid ${C.border}`, marginBottom: 6, cursor: "pointer", display: "flex", alignItems: "center", gap: 9 }}>
                    <span style={{ fontSize: 16 }}>{c.icon}</span>
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>{c.titulo}</span>
                    {prog.cursos[c.id]?.concluido && <span style={{ color: C.green, fontSize: 12 }}>✓</span>}
                  </button>
                )) : <div style={{ fontSize: 11, color: C.muted, textAlign: "center", padding: 14 }}>🔜 Cursos em breve</div>}
                {cursos.length > 0 && <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>{feitos}/{cursos.length} concluído(s)</div>}
              </div>
            </Card>
          ); })}
        </div>
      )}

      {/* BIBLIOTECA */}
      {aba === "biblioteca" && (
        <div>
          <div style={{ padding: "12px 16px", background: `${C.accent}07`, border: `1px solid ${C.accent}18`, borderRadius: 10, fontSize: 12, color: C.sub, marginBottom: 14 }}>📚 Biblioteca Científica FisioPiede — apostilas, protocolos e guias clínicos da rede.</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12 }}>
            {ACADEMY_BIBLIOTECA.map((b, i) => (
              <Card key={i} p={18} style={{ border: `1px solid ${b.cor}20` }}>
                <div style={{ display: "flex", gap: 12 }}>
                  <div style={{ width: 46, height: 58, borderRadius: 8, background: `linear-gradient(135deg,${b.cor}25,${b.cor}08)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0 }}>{b.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Badge label={b.tipo} color={b.cor} />
                    <div style={{ fontWeight: 800, fontSize: 13, margin: "6px 0 4px", lineHeight: 1.3 }}>{b.titulo}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>{b.paginas} páginas</div>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: C.sub, lineHeight: 1.6, marginTop: 10 }}>{b.desc}</div>
                <Btn v="outline" sz="sm" full style={{ marginTop: 12, justifyContent: "center" }} onClick={() => { setLivroAberto(b); setCapAtual(0); }}>📖 Abrir material</Btn>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* GLOSSÁRIO */}
      {aba === "glossario" && (
        <div>
          <div style={{ padding: "12px 16px", background: `${C.purple}07`, border: `1px solid ${C.purple}18`, borderRadius: 10, fontSize: 12, color: C.sub, marginBottom: 14 }}>📖 Glossário técnico FisioPiede — os principais termos da posturologia, baropodometria e biomecânica que todo profissional da rede domina.</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 12 }}>
            {ACADEMY_GLOSSARIO.map((g, i) => (
              <Card key={i} p={16} style={{ border: `1px solid ${C.purple}18` }}>
                <div style={{ fontWeight: 800, fontSize: 13, color: C.purple, marginBottom: 6 }}>{g.termo}</div>
                <div style={{ fontSize: 12, color: C.sub, lineHeight: 1.7 }}>{g.def}</div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* CERTIFICADOS */}
      {aba === "certificados" && (
        <div>
          {prog.certificados.length === 0 ? (
            <Card p={36} style={{ textAlign: "center", color: C.muted }}><div style={{ fontSize: 44, marginBottom: 12 }}>🎖️</div><div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Nenhum certificado ainda</div><div style={{ fontSize: 12 }}>Conclua cursos e seja aprovado nas provas para receber seus certificados.</div></Card>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 12 }}>
              {prog.certificados.map((cert, i) => (
                <Card key={i} p={18} style={{ border: `1px solid ${C.amber}30`, background: `linear-gradient(135deg,${C.amber}08,${C.purple}04)`, cursor: "pointer" }} onClick={() => setCertAberto(cert)}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}><span style={{ fontSize: 30 }}>🎖️</span><Badge label={`Nota ${cert.nota}%`} color={C.green} /></div>
                  <div style={{ fontWeight: 800, fontSize: 14, lineHeight: 1.3 }}>{cert.curso}</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>{cert.horas}h · {new Date(cert.data).toLocaleDateString("pt-BR")}</div>
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 4, fontFamily: "monospace" }}>{cert.id}</div>
                  <Btn v="outline" sz="sm" full style={{ marginTop: 12, justifyContent: "center" }}>Ver certificado →</Btn>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* RANKING */}
      {aba === "ranking" && (
        <div>
          <div style={{ padding: "12px 16px", background: `${C.amber}07`, border: `1px solid ${C.amber}18`, borderRadius: 10, fontSize: 12, color: C.sub, marginBottom: 14 }}>🏆 Ranking de engajamento da rede FisioPiede (exemplo demonstrativo + sua posição real).</div>
          {(() => {
            const demo = [
              { nome: "Clínica São Paulo", xp: 1850, certs: 8 }, { nome: "Clínica Rio Centro", xp: 1420, certs: 6 },
              { nome: "Clínica BH Sul", xp: 980, certs: 5 }, { nome: clinicaName || userName, xp: prog.xp, certs: prog.certificados.length, eu: true },
              { nome: "Clínica Curitiba", xp: 540, certs: 2 }, { nome: "Clínica Recife", xp: 320, certs: 1 },
            ].sort((a, b) => b.xp - a.xp);
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {demo.map((r, i) => (
                  <Card key={i} p={14} style={{ border: r.eu ? `1px solid ${C.accent}40` : `1px solid ${C.border}`, background: r.eu ? `${C.accent}08` : C.bgCard }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ width: 30, height: 30, borderRadius: "50%", background: i < 3 ? [`${C.amber}25`, `#C0C0C033`, `#CD7F3233`][i] : C.bgGlass, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 900, color: i < 3 ? [C.amber, "#C0C0C0", "#CD7F32"][i] : C.muted }}>{i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1}</div>
                      <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 13 }}>{r.nome} {r.eu && <span style={{ fontSize: 10, color: C.accent }}>(você)</span>}</div><div style={{ fontSize: 10, color: C.muted }}>{r.certs} certificado(s)</div></div>
                      <div style={{ fontWeight: 900, fontSize: 15, color: C.accent }}>{r.xp} XP</div>
                    </div>
                  </Card>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {/* TUTOR IA */}
      {aba === "tutor" && (
        <Card hover={false} p={0} style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 230px)", overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10, background: `linear-gradient(135deg,${C.accent}08,${C.purple}04)` }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: `linear-gradient(135deg,${C.accent},${C.purple})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>✦</div>
            <div><div style={{ fontWeight: 800, fontSize: 14 }}>Tutor IA FisioPiede</div><div style={{ fontSize: 11, color: C.muted }}>Responde com base nos cursos e protocolos FisioPiede</div></div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            {tutorMsgs.length === 0 && <div style={{ textAlign: "center", color: C.muted, fontSize: 12, marginTop: 30 }}><div style={{ fontSize: 32, marginBottom: 8 }}>✦</div>Pergunte algo como:<br />"O que é o centro de pressão?"<br />"Qual palmilha para fascite plantar?"</div>}
            {tutorMsgs.map((m, i) => (
              <div key={i} style={{ display: "flex", justifyContent: m.de === "user" ? "flex-end" : "flex-start" }}>
                <div style={{ maxWidth: "75%", padding: "10px 14px", borderRadius: m.de === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px", background: m.de === "user" ? C.accent : C.bgGlass, border: `1px solid ${m.de === "user" ? C.accent : C.border}`, fontSize: 13, lineHeight: 1.6, color: m.de === "user" ? "#fff" : C.sub }}>{m.txt}</div>
              </div>
            ))}
            {tutorLoading && <div style={{ display: "flex", gap: 6, alignItems: "center", color: C.muted, fontSize: 12 }}><Spin sz={14} /> Tutor pensando...</div>}
          </div>
          <div style={{ borderTop: `1px solid ${C.border}`, padding: 12, display: "flex", gap: 8 }}>
            <input value={tutorInput} onChange={e => setTutorInput(e.target.value)} onKeyDown={e => e.key === "Enter" && perguntarTutor()} placeholder="Digite sua dúvida..." />
            <Btn v="primary" onClick={perguntarTutor} disabled={tutorLoading || !tutorInput.trim()}>Enviar</Btn>
          </div>
        </Card>
      )}

      {/* LEITOR DE APOSTILA */}
      {livroAberto && (
        <Modal onClose={() => setLivroAberto(null)}>
          <Card hover={false} p={0} style={{ width: "100%", maxWidth: 760, height: "88vh", display: "flex", flexDirection: "column", animation: "fadeUp .25s ease" }}>
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", background: `linear-gradient(135deg,${livroAberto.cor}10,${livroAberto.cor}03)` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 38, height: 48, borderRadius: 7, background: `linear-gradient(135deg,${livroAberto.cor}30,${livroAberto.cor}10)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>{livroAberto.icon}</div>
                <div><div style={{ fontWeight: 800, fontSize: 14 }}>{livroAberto.titulo}</div><div style={{ fontSize: 11, color: C.muted }}>{livroAberto.tipo} · {livroAberto.paginas} páginas</div></div>
              </div>
              <button onClick={() => setLivroAberto(null)} style={{ background: "none", color: C.muted, fontSize: 18 }}>✕</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", flex: 1, overflow: "hidden" }}>
              {/* Índice */}
              <div style={{ borderRight: `1px solid ${C.border}`, overflowY: "auto", padding: 12, background: C.bgGlass }}>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase", marginBottom: 8 }}>Índice</div>
                {(livroAberto.conteudo || []).map((cap, i) => (
                  <button key={i} onClick={() => setCapAtual(i)} style={{ width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 7, background: capAtual === i ? `${livroAberto.cor}15` : "transparent", border: "none", cursor: "pointer", marginBottom: 3, display: "flex", gap: 7, alignItems: "flex-start" }}>
                    <span style={{ fontSize: 10, color: livroAberto.cor, fontWeight: 800, flexShrink: 0 }}>{i + 1}.</span>
                    <span style={{ fontSize: 11, color: capAtual === i ? livroAberto.cor : C.sub, fontWeight: capAtual === i ? 700 : 400, lineHeight: 1.3 }}>{cap.cap}</span>
                  </button>
                ))}
              </div>
              {/* Conteúdo */}
              <div style={{ overflowY: "auto", padding: "24px 28px" }}>
                {livroAberto.conteudo && livroAberto.conteudo[capAtual] ? (
                  <div>
                    <div style={{ fontSize: 10, color: livroAberto.cor, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Capítulo {capAtual + 1}</div>
                    <div style={{ fontSize: 19, fontWeight: 900, marginBottom: 16 }}>{livroAberto.conteudo[capAtual].cap}</div>
                    <div style={{ fontSize: 14, color: C.sub, lineHeight: 1.95, textAlign: "justify" }}>{livroAberto.conteudo[capAtual].txt}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 28, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
                      <Btn v="ghost" sz="sm" disabled={capAtual === 0} onClick={() => setCapAtual(c => Math.max(0, c - 1))}>← Anterior</Btn>
                      <span style={{ fontSize: 11, color: C.muted, alignSelf: "center" }}>{capAtual + 1} / {livroAberto.conteudo.length}</span>
                      <Btn v="ghost" sz="sm" disabled={capAtual >= livroAberto.conteudo.length - 1} onClick={() => setCapAtual(c => Math.min(livroAberto.conteudo.length - 1, c + 1))}>Próximo →</Btn>
                    </div>
                  </div>
                ) : <div style={{ color: C.muted, textAlign: "center", marginTop: 40 }}>Conteúdo não disponível.</div>}
              </div>
            </div>
            <div style={{ padding: "10px 20px", borderTop: `1px solid ${C.border}`, fontSize: 10, color: C.muted, textAlign: "center" }}>
              📄 Prévia do material FisioPiede. Versão completa em PDF disponível para download quando o sistema for publicado.
            </div>
          </Card>
        </Modal>
      )}

      {/* MODAL CERTIFICADO */}
      {certAberto && (
        <Modal onClose={() => setCertAberto(null)}>
          <Card hover={false} p={0} style={{ width: "100%", maxWidth: 600, animation: "fadeUp .25s ease" }}>
            <div style={{ padding: 36, background: `linear-gradient(135deg,${C.bgCard},${C.purple}08)`, border: `2px solid ${C.amber}40`, borderRadius: 16, textAlign: "center", position: "relative" }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>🎖️</div>
              <div style={{ fontSize: 11, color: C.amber, fontWeight: 800, letterSpacing: ".15em", textTransform: "uppercase" }}>Certificado de Conclusão</div>
              <div style={{ fontSize: 22, fontWeight: 900, margin: "16px 0 6px", background: `linear-gradient(135deg,${C.accent},${C.purple})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Fisio<span>Piede</span> Academy</div>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 20 }}>certifica que</div>
              <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>{certAberto.nome}</div>
              <div style={{ fontSize: 12, color: C.sub, marginBottom: 20 }}>concluiu com aproveitamento o curso</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: C.accent, marginBottom: 20 }}>{certAberto.curso}</div>
              <div style={{ display: "flex", justifyContent: "center", gap: 24, fontSize: 11, color: C.muted, marginBottom: 18 }}>
                <div><div style={{ fontWeight: 800, color: C.text, fontSize: 14 }}>{certAberto.horas}h</div>carga horária</div>
                <div><div style={{ fontWeight: 800, color: C.text, fontSize: 14 }}>{certAberto.nota}%</div>aproveitamento</div>
                <div><div style={{ fontWeight: 800, color: C.text, fontSize: 14 }}>{new Date(certAberto.data).toLocaleDateString("pt-BR")}</div>conclusão</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
                <div style={{ width: 50, height: 50, borderRadius: 6, background: "#fff", padding: 4, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div style={{ fontSize: 7, fontFamily: "monospace", color: "#000", lineHeight: 1, textAlign: "center", wordBreak: "break-all" }}>▦▦▦<br />▦{certAberto.id.slice(-4)}▦<br />▦▦▦</div>
                </div>
                <div style={{ textAlign: "left" }}><div style={{ fontSize: 9, color: C.muted }}>Código de validação</div><div style={{ fontSize: 11, fontFamily: "monospace", fontWeight: 700 }}>{certAberto.id}</div></div>
              </div>
            </div>
            <div style={{ padding: 16, display: "flex", gap: 8, justifyContent: "center" }}><Btn v="ghost" onClick={() => setCertAberto(null)}>Fechar</Btn><Btn v="primary" onClick={() => window.print && window.print()}>🖨️ Imprimir / PDF</Btn></div>
          </Card>
        </Modal>
      )}
    </div>
  );
}



// ══════════════════════════════════════════════════════════════════════════════
// NOTIFICAÇÕES
// ══════════════════════════════════════════════════════════════════════════════
function pushNotif(destino, icon, titulo, texto, pagina) {
  try {
    const key = "fp:notif:" + destino;
    const atual = LS.read(key) || [];
    const nova = { id: Date.now() + Math.random(), icon, titulo, texto, ts: Date.now(), lida: false, pagina: pagina || null };
    LS.write(key, [nova, ...atual].slice(0, 50));
  } catch (e) {}
}

// 🎯 Pendências do AGORA: o que está esperando uma ação do admin, calculado em tempo real
function PendenciasAdmin({ pedidos, clinicas, pacientes, onNavegar }) {
  const [tick,setTick] = useState(0);
  useEffect(()=>{ const iv=setInterval(()=>setTick(t=>t+1), 5000); return ()=>clearInterval(iv); },[]);

  // Clínicas aguardando aprovação
  const solicitacoes = LS.read("fp:solicitacoes") || [];
  // Pedidos novos (recém-chegados, ainda no início do fluxo)
  const pedidosNovos = (pedidos||[]).filter(p=>p.status==="Recebido");
  // Pedidos parados em produção (não finalizados nem só recebidos)
  const emAndamento = (pedidos||[]).filter(p=>!["Recebido","Finalizado","Enviado"].includes(p.status));
  // Mensagens de pacientes sem resposta (não lidas pela clínica/admin)
  let msgsNaoLidas = 0, pacientesComMsg = [];
  (pacientes||[]).forEach(p=>{
    const msgs = LS.read("fp:chat:"+p.id) || [];
    const lidoAte = Number(LS.read("fp:chatlido:clinica:"+p.id) || 0);
    const n = msgs.filter(m=>m.de==="paciente" && m.ts>lidoAte).length;
    if(n>0){ msgsNaoLidas += n; pacientesComMsg.push(`${p.nome} ${p.sobrenome||""}`.trim()); }
  });
  // Fechamentos a receber (clínicas com pedidos faturados ainda não pagos)
  const pagos = LS.read("fp:pagamentos") || {};
  const clinicasDevendo = (clinicas||[]).filter(c=>{
    const np = c?.pedidosReal ?? c?.pedidos ?? 0;
    return np>0 && !pagos[c?.nome];
  }).length;

  const itens = [];
  if(solicitacoes.length>0) itens.push({ icon:"📩", cor:C.amber, titulo:`${solicitacoes.length} clínica${solicitacoes.length!==1?"s":""} aguardando aprovação`, sub: solicitacoes.slice(0,3).map(s=>s.clinica).filter(Boolean).join(", ")+(solicitacoes.length>3?"...":""), pg:"clinicas", btn:"Aprovar agora" });
  if(pedidosNovos.length>0) itens.push({ icon:"📥", cor:C.accent, titulo:`${pedidosNovos.length} pedido${pedidosNovos.length!==1?"s":""} novo${pedidosNovos.length!==1?"s":""} para analisar`, sub: pedidosNovos.slice(0,3).map(p=>`${p.id} · ${p.paciente}`).join(", "), pg:"pedidos", btn:"Ver pedidos" });
  if(msgsNaoLidas>0) itens.push({ icon:"💬", cor:C.purple, titulo:`${msgsNaoLidas} ${msgsNaoLidas!==1?"mensagens":"mensagem"} de paciente${pacientesComMsg.length!==1?"s":""} sem resposta`, sub: pacientesComMsg.slice(0,3).join(", ")+(pacientesComMsg.length>3?"...":""), pg:"pacientes", btn:"Responder" });
  if(emAndamento.length>0) itens.push({ icon:"⚙️", cor:C.gold, titulo:`${emAndamento.length} pedido${emAndamento.length!==1?"s":""} em produção`, sub:"Acompanhe o andamento no painel de produção", pg:"producao", btn:"Abrir produção" });
  if(clinicasDevendo>0) itens.push({ icon:"💰", cor:C.green, titulo:`${clinicasDevendo} clínica${clinicasDevendo!==1?"s":""} com fechamento a receber`, sub:"Registre o pagamento quando receber", pg:"financeiro", btn:"Ir ao financeiro" });

  if(itens.length===0){
    return (
      <Card hover={false} p={0} style={{overflow:"hidden",border:`1px solid ${C.green}30`,marginBottom:16}}>
        <div style={{padding:"16px 18px",background:`${C.green}08`,display:"flex",alignItems:"center",gap:12}}>
          <span style={{fontSize:26}}>✅</span>
          <div><div style={{fontSize:14,fontWeight:800,color:C.green}}>Tudo em dia!</div><div style={{fontSize:11.5,color:C.muted,marginTop:1}}>Nenhuma clínica, pedido ou mensagem esperando você agora.</div></div>
        </div>
      </Card>
    );
  }
  const totalPend = solicitacoes.length + pedidosNovos.length + msgsNaoLidas;
  return (
    <Card hover={false} p={0} style={{overflow:"hidden",border:`1px solid ${C.amber}40`,marginBottom:16}}>
      <div style={{padding:"14px 18px",background:`linear-gradient(135deg,${C.amber}10,${C.red}06)`,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap",borderBottom:`1px solid ${C.border}`}}>
        <div style={{display:"flex",alignItems:"center",gap:11}}>
          <span style={{fontSize:24}}>🎯</span>
          <div><div style={{fontSize:14,fontWeight:800}}>Precisa da sua atenção</div><div style={{fontSize:11,color:C.muted,marginTop:1}}>{itens.length} tipo{itens.length!==1?"s":""} de pendência para resolver</div></div>
        </div>
        {totalPend>0 && <Badge label={`${totalPend} ${totalPend!==1?"itens urgentes":"item urgente"}`} color={C.amber}/>}
      </div>
      {itens.map((it,i)=>(
        <div key={i} style={{padding:"12px 18px",borderBottom:i<itens.length-1?`1px solid ${C.border}`:"none",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
          <div style={{width:38,height:38,borderRadius:10,background:`${it.cor}18`,border:`1px solid ${it.cor}35`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{it.icon}</div>
          <div style={{flex:1,minWidth:160}}>
            <div style={{fontSize:13,fontWeight:700,color:C.text}}>{it.titulo}</div>
            {it.sub && <div style={{fontSize:11,color:C.muted,marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.sub}</div>}
          </div>
          <Btn v="primary" sz="sm" onClick={()=>onNavegar&&onNavegar(it.pg)} style={{background:it.cor,flexShrink:0}}>{it.btn} →</Btn>
        </div>
      ))}
    </Card>
  );
}

function NotificacoesPage({ destino, onNavegar, pedidos, clinicas, pacientes }) {
  const key = "fp:notif:" + destino;
  const [notifs, setNotifs] = useState(() => LS.read(key) || []);
  const [filtro, setFiltro] = useState("todas"); // todas | naolidas
  useEffect(() => {
    (async () => { const n = await LS.readAsync(key); if (n) setNotifs(n); })();
    const iv = setInterval(() => { const n = LS.read(key); if (n) setNotifs(n); }, 4000);
    return () => clearInterval(iv);
  }, [destino]);

  const naoLidas = notifs.filter(n => !n.lida).length;
  const persist = (arr) => { setNotifs(arr); LS.write(key, arr); };
  const marcarLida = (id) => persist(notifs.map(n => n.id === id ? { ...n, lida: true } : n));
  const marcarTodas = () => persist(notifs.map(n => ({ ...n, lida: true })));
  const limpar = () => { if (window.confirm("Limpar todas as notificações? Esta ação não pode ser desfeita.")) persist([]); };
  const abrir = (n) => { marcarLida(n.id); if (n.pagina && onNavegar) onNavegar(n.pagina); };
  const lista = filtro === "naolidas" ? notifs.filter(n => !n.lida) : notifs;

  return (
    <div>
      {destino==="admin:master" && <PendenciasAdmin pedidos={pedidos} clinicas={clinicas} pacientes={pacientes} onNavegar={onNavegar}/>}
      <SH title="Notificações" sub={naoLidas > 0 ? `${naoLidas} não lida(s)` : "Tudo em dia"} right={
        <div style={{ display: "flex", gap: 7 }}>
          {naoLidas > 0 && <Btn v="outline" sz="sm" onClick={marcarTodas}>✓ Marcar todas como lidas</Btn>}
          {notifs.length > 0 && <Btn v="ghost" sz="sm" onClick={limpar}>Limpar tudo</Btn>}
        </div>
      } />
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {[["todas", `Todas (${notifs.length})`], ["naolidas", `Não lidas (${naoLidas})`]].map(([k, l]) => (
          <button key={k} onClick={() => setFiltro(k)} style={{ padding: "7px 14px", borderRadius: 99, border: `1px solid ${filtro === k ? C.accent : C.border}`, background: filtro === k ? `${C.accent}12` : "transparent", color: filtro === k ? C.accent : C.sub, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{l}</button>
        ))}
      </div>
      {lista.length === 0 ? (
        <Card hover={false} p={40} style={{ textAlign: "center", color: C.muted }}><div style={{ fontSize: 40, marginBottom: 10 }}>🔔</div><div style={{ fontSize: 14, fontWeight: 700 }}>{filtro === "naolidas" ? "Nenhuma notificação não lida" : "Nenhuma notificação"}</div></Card>
      ) : (
        <Card hover={false} p={0} style={{ overflow: "hidden" }}>
          {lista.map(n => (
            <div key={n.id} onClick={() => abrir(n)} style={{ padding: "14px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 12, background: n.lida ? "transparent" : `${C.accent}07`, cursor: n.pagina ? "pointer" : "default", alignItems: "flex-start" }}>
              <span style={{ fontSize: 22, flexShrink: 0 }}>{n.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{n.titulo}</div>
                {n.texto && <div style={{ fontSize: 12, color: C.sub, lineHeight: 1.5, marginTop: 2 }}>{n.texto}</div>}
                <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>{new Date(n.ts).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}{n.pagina && <span style={{ color: C.accent, marginLeft: 6, fontWeight: 700 }}>· toque para abrir</span>}</div>
              </div>
              {!n.lida && <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.accent, flexShrink: 0, marginTop: 5 }} />}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function NotifBell({ destino, onNavegar }) {
  const key = "fp:notif:" + destino;
  const [aberto, setAberto] = useState(false);
  const [notifs, setNotifs] = useState(() => LS.read(key) || []);
  useEffect(() => {
    const load = async () => { const n = await LS.readAsync(key); if (n) setNotifs(n); };
    load();
    const iv = setInterval(() => { const n = LS.read(key); if (n) setNotifs(n); }, 4000);
    return () => clearInterval(iv);
  }, [destino]);

  const naoLidas = notifs.filter(n => !n.lida).length;
  const marcarTodas = () => { const m = notifs.map(n => ({ ...n, lida: true })); setNotifs(m); LS.write(key, m); };
  const limpar = () => { setNotifs([]); LS.write(key, []); };

  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => { setAberto(a => !a); if (!aberto && naoLidas > 0) setTimeout(marcarTodas, 1500); }} style={{ position: "relative", background: "none", border: "none", cursor: "pointer", fontSize: 18, padding: 4 }}>
        🔔
        {naoLidas > 0 && <span style={{ position: "absolute", top: 0, right: 0, minWidth: 15, height: 15, borderRadius: 99, background: C.red, color: "#fff", fontSize: 9, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px" }}>{naoLidas}</span>}
      </button>
      {aberto && (
        <>
          <div onClick={() => setAberto(false)} style={{ position: "fixed", inset: 0, zIndex: 90 }} />
          <div style={{ position: "absolute", top: 36, right: 0, width: 320, maxHeight: 420, overflowY: "auto", background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,.4)", zIndex: 91 }}>
            <div style={{ padding: "12px 14px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 800, fontSize: 13 }}>Notificações</span>
              {notifs.length > 0 && <button onClick={limpar} style={{ background: "none", border: "none", color: C.muted, fontSize: 10, cursor: "pointer" }}>Limpar tudo</button>}
            </div>
            {notifs.length === 0 ? (
              <div style={{ padding: 28, textAlign: "center", color: C.muted, fontSize: 12 }}><div style={{ fontSize: 28, marginBottom: 6 }}>🔔</div>Nenhuma notificação</div>
            ) : notifs.map(n => (
              <div key={n.id} onClick={() => { if (n.pagina && onNavegar) { onNavegar(n.pagina); setAberto(false); } }} style={{ padding: "11px 14px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 10, background: n.lida ? "transparent" : `${C.accent}06`, cursor: n.pagina ? "pointer" : "default" }}>
                <span style={{ fontSize: 18, flexShrink: 0 }}>{n.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{n.titulo}</div>
                  {n.texto && <div style={{ fontSize: 11, color: C.sub, lineHeight: 1.4, marginTop: 2 }}>{n.texto}</div>}
                  <div style={{ fontSize: 9, color: C.muted, marginTop: 3 }}>{new Date(n.ts).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}{n.pagina && <span style={{ color: C.accent, marginLeft: 6, fontWeight: 700 }}>· toque para abrir</span>}</div>
                </div>
                {!n.lida && <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.accent, flexShrink: 0, marginTop: 4 }} />}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}



// ══════════════════════════════════════════════════════════════════════════════
// CHAT PACIENTE ↔ CLÍNICA
// ══════════════════════════════════════════════════════════════════════════════
function ChatBox({ pacienteId, remetente, nomePaciente, nomeClinica }) {
  const chaveKey = "fp:chat:" + pacienteId;
  const [msgs, setMsgs] = useState(() => LS.read(chaveKey) || []);
  const [input, setInput] = useState("");
  useEffect(() => {
    (async () => { const m = await LS.readAsync(chaveKey); if (m) setMsgs(m); })();
    // Conversa aberta se atualiza sozinha (novas mensagens aparecem sem recarregar)
    const iv = setInterval(() => { const m = LS.read(chaveKey); if (m && m.length !== undefined) setMsgs(prev => (m.length !== prev.length ? m : prev)); }, 5000);
    return () => clearInterval(iv);
  }, [pacienteId]);
  // Marca a conversa como lida para quem está com ela aberta
  useEffect(() => { try { LS.write("fp:chatlido:" + remetente + ":" + pacienteId, Date.now()); } catch(e){} }, [pacienteId, msgs.length]);

  const enviar = () => {
    if (!input.trim()) return;
    const nova = { de: remetente, txt: input.trim(), ts: Date.now() };
    const novas = [...msgs, nova];
    setMsgs(novas); LS.write(chaveKey, novas);
    // Gera notificação para o outro lado
    const destino = remetente === "paciente" ? "clinica:" + (LS.read("fp:pac:" + pacienteId)?.clinicaId || "") : "paciente:" + pacienteId;
    pushNotif(destino, "💬", `Nova mensagem de ${remetente === "paciente" ? nomePaciente : nomeClinica}`, input.trim().slice(0, 40), "mensagens");
    setInput("");
  };

  return (
    <Card hover={false} p={0} style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 220px)", overflow: "hidden" }}>
      <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10, background: `linear-gradient(135deg,${C.accent}08,${C.purple}04)` }}>
        <div style={{ width: 34, height: 34, borderRadius: "50%", background: `linear-gradient(135deg,${C.accent},${C.purple})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>💬</div>
        <div><div style={{ fontWeight: 800, fontSize: 14 }}>{remetente === "paciente" ? nomeClinica || "Minha Clínica" : nomePaciente}</div><div style={{ fontSize: 11, color: C.muted }}>Conversa segura · FisioPiede</div></div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        {msgs.length === 0 && <div style={{ textAlign: "center", color: C.muted, fontSize: 12, marginTop: 30 }}><div style={{ fontSize: 32, marginBottom: 8 }}>💬</div>Nenhuma mensagem ainda.<br />Envie a primeira mensagem.</div>}
        {msgs.map((m, i) => { const meu = m.de === remetente; return (
          <div key={i} style={{ display: "flex", justifyContent: meu ? "flex-end" : "flex-start" }}>
            <div style={{ maxWidth: "75%" }}>
              <div style={{ padding: "10px 14px", borderRadius: meu ? "14px 14px 4px 14px" : "14px 14px 14px 4px", background: meu ? C.accent : C.bgGlass, border: `1px solid ${meu ? C.accent : C.border}`, fontSize: 13, lineHeight: 1.5, color: meu ? "#fff" : C.sub }}>{m.txt}</div>
              <div style={{ fontSize: 9, color: C.muted, marginTop: 3, textAlign: meu ? "right" : "left" }}>{new Date(m.ts).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>
            </div>
          </div>
        ); })}
      </div>
      <div style={{ borderTop: `1px solid ${C.border}`, padding: 12, display: "flex", gap: 8 }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && enviar()} placeholder="Digite sua mensagem..." />
        <Btn v="primary" onClick={enviar} disabled={!input.trim()}>Enviar</Btn>
      </div>
    </Card>
  );
}

// 💬 Caixa de Mensagens da CLÍNICA — lista de conversas com pacientes + chat
function MensagensClinicaPage({ pacientes, clinicaId, clinicaName }) {
  const [sel, setSel] = useState(null);   // paciente selecionado
  const [tick, setTick] = useState(0);    // atualiza a lista periodicamente
  useEffect(() => { const iv = setInterval(() => setTick(t => t + 1), 5000); return () => clearInterval(iv); }, []);

  // Monta as conversas: paciente + mensagens + não lidas + última mensagem
  const conversas = (pacientes || []).map(p => {
    const msgs = LS.read("fp:chat:" + p.id) || [];
    const lidoAte = Number(LS.read("fp:chatlido:clinica:" + p.id) || 0);
    const naoLidas = msgs.filter(m => m.de === "paciente" && m.ts > lidoAte).length;
    const ultima = msgs.length > 0 ? msgs[msgs.length - 1] : null;
    return { p, msgs, naoLidas, ultima };
  }).sort((a, b) => {
    if (b.naoLidas !== a.naoLidas) return b.naoLidas - a.naoLidas;       // não lidas primeiro
    return ((b.ultima && b.ultima.ts) || 0) - ((a.ultima && a.ultima.ts) || 0); // depois mais recentes
  });
  const totalNaoLidas = conversas.reduce((a, c) => a + c.naoLidas, 0);
  const comHistorico = conversas.filter(c => c.msgs.length > 0);
  const semHistorico = conversas.filter(c => c.msgs.length === 0);

  if (sel) {
    return (
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Btn v="ghost" sz="sm" onClick={() => setSel(null)}>← Conversas</Btn>
          <SH title={`💬 ${sel.nome} ${sel.sobrenome || ""}`} sub="Conversa segura · FisioPiede" />
        </div>
        <ChatBox pacienteId={sel.id} remetente="clinica" nomePaciente={`${sel.nome} ${sel.sobrenome || ""}`.trim()} nomeClinica={clinicaName} />
      </div>
    );
  }

  return (
    <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
      <SH title="💬 Mensagens" sub={totalNaoLidas > 0 ? `${totalNaoLidas} ${totalNaoLidas !== 1 ? "mensagens não lidas" : "mensagem não lida"}` : "Converse com seus pacientes pelo portal"} />
      {conversas.length === 0 && (
        <Card hover={false}><div style={{ textAlign: "center", padding: 24, color: C.muted }}><div style={{ fontSize: 32, marginBottom: 8 }}>💬</div><div style={{ fontSize: 13, fontWeight: 700, color: C.sub }}>Nenhum paciente cadastrado ainda</div><div style={{ fontSize: 11, marginTop: 4 }}>Cadastre pacientes para conversar com eles pelo portal.</div></div></Card>
      )}
      {comHistorico.length > 0 && (
        <Card hover={false} p={0} style={{ overflow: "hidden" }}>
          {comHistorico.map(({ p, naoLidas, ultima }, i) => (
            <div key={p.id} onClick={() => setSel(p)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", borderTop: i > 0 ? `1px solid ${C.border}` : "none", cursor: "pointer", background: naoLidas > 0 ? `${C.accent}07` : "transparent" }}>
              <div style={{ width: 40, height: 40, borderRadius: "50%", flexShrink: 0, background: `linear-gradient(135deg,${C.accent},${C.purple})`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, color: "#fff", fontSize: 15 }}>{(p.nome || "?").charAt(0).toUpperCase()}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: naoLidas > 0 ? 900 : 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.nome} {p.sobrenome || ""}</div>
                <div style={{ fontSize: 11, color: naoLidas > 0 ? C.sub : C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>{ultima ? (ultima.de === "clinica" ? "Você: " : "") + ultima.txt : ""}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                {ultima && <div style={{ fontSize: 9.5, color: C.muted }}>{new Date(ultima.ts).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</div>}
                {naoLidas > 0 && <span style={{ minWidth: 20, height: 20, borderRadius: 99, background: C.accent, color: "#fff", fontSize: 10.5, fontWeight: 900, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 6px" }}>{naoLidas}</span>}
              </div>
            </div>
          ))}
        </Card>
      )}
      {semHistorico.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".07em", margin: "4px 0 8px" }}>Iniciar conversa</div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            {semHistorico.slice(0, 20).map(({ p }) => (
              <button key={p.id} onClick={() => setSel(p)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 99, background: C.bgGlass, border: `1px solid ${C.border}`, color: C.sub, fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>💬 {p.nome} {p.sobrenome || ""}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Página de mensagens do paciente
function MensagensPacientePage({ paciente }) {
  const pac = paciente || {};
  return (
    <div style={{ padding: 20 }}>
      <SH title="Mensagens" sub="Converse com sua clínica" />
      <ChatBox pacienteId={pac.id} remetente="paciente" nomePaciente={`${pac.nome} ${pac.sobrenome}`} nomeClinica={pac.clinica} />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// EVOLUÇÃO DA DOR (escala EVA 0-10)
// ══════════════════════════════════════════════════════════════════════════════
function EvolucaoDor({ pacienteId, editavel }) {
  const chaveKey = "fp:dor:" + pacienteId;
  const [registros, setRegistros] = useState(() => LS.read(chaveKey) || []);
  const [nivel, setNivel] = useState(5);
  // junta por data (um registro por dia); o registro local prevalece
  const mesclarDor = (a, b) => {
    const mapa = {};
    (a || []).forEach(r => { if (r && r.data) mapa[r.data] = r; });
    (b || []).forEach(r => { if (r && r.data) mapa[r.data] = r; });
    return Object.values(mapa).sort((x, y) => x.data.localeCompare(y.data));
  };
  useEffect(() => { (async () => { const r = await LS.readAsync(chaveKey); if (r) setRegistros(prev => mesclarDor(r, prev)); })(); }, [pacienteId]);

  const registrar = async () => {
    const hoje = new Date().toISOString().split("T")[0];
    const semHoje = registros.filter(r => r.data !== hoje);
    const novos = [...semHoje, { data: hoje, nivel }].sort((a, b) => a.data.localeCompare(b.data));
    setRegistros(novos); // mostra na hora
    try {
      const nuvem = (await LS.readAsync(chaveKey)) || [];
      LS.write(chaveKey, mesclarDor(nuvem, novos)); // junta com a nuvem antes de gravar (não apaga outros)
    } catch (e) { LS.write(chaveKey, novos); }
  };

  const corDor = (n) => n <= 3 ? C.green : n <= 6 ? C.amber : C.red;
  const ultimos = registros.slice(-12);
  const max = 10, alturaG = 120;

  return (
    <Card hover={false} p={20}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontWeight: 800, fontSize: 14 }}>📈 Evolução da Dor</div>
        {registros.length > 0 && <Badge label={`Atual: ${registros[registros.length - 1].nivel}/10`} color={corDor(registros[registros.length - 1].nivel)} />}
      </div>

      {ultimos.length > 0 ? (
        <div style={{ marginBottom: editavel ? 18 : 0 }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: alturaG, padding: "0 0 22px", position: "relative", borderBottom: `1px solid ${C.border}` }}>
            {ultimos.map((r, i) => (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", position: "relative" }}>
                <span style={{ fontSize: 9, fontWeight: 800, color: corDor(r.nivel), marginBottom: 3 }}>{r.nivel}</span>
                <div style={{ width: "100%", maxWidth: 26, height: `${(r.nivel / max) * 100}%`, background: `linear-gradient(180deg,${corDor(r.nivel)},${corDor(r.nivel)}99)`, borderRadius: "5px 5px 0 0", minHeight: 4, transition: "height .4s" }} />
                <span style={{ fontSize: 8, color: C.muted, position: "absolute", bottom: -18, whiteSpace: "nowrap" }}>{r.data.slice(8, 10)}/{r.data.slice(5, 7)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ textAlign: "center", color: C.muted, fontSize: 12, padding: "20px 0" }}>{editavel ? "Registre seu nível de dor para acompanhar a evolução." : "O paciente ainda não registrou níveis de dor."}</div>
      )}

      {editavel && (
        <div style={{ paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 12, color: C.sub, marginBottom: 8 }}>Como está sua dor hoje? <strong style={{ color: corDor(nivel) }}>{nivel}/10</strong></div>
          <input type="range" min="0" max="10" value={nivel} onChange={e => setNivel(Number(e.target.value))} style={{ width: "100%", accentColor: corDor(nivel) }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: C.muted, marginTop: 2 }}><span>Sem dor</span><span>Dor máxima</span></div>
          <Btn v="primary" full sz="sm" style={{ marginTop: 12 }} onClick={registrar}>Registrar dor de hoje</Btn>
        </div>
      )}
    </Card>
  );
}



// ══════════════════════════════════════════════════════════════════════════════
// IA DE BAROPODOMETRIA — análise de imagem de exame
// ══════════════════════════════════════════════════════════════════════════════
function BaropodometriaIA({ clinicaId, planoIA, pacientes, setPacientes, onUsoIA }) {
  const [img, setImg] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [erro, setErro] = useState("");
  const [pacBaro, setPacBaro] = useState("");
  const [salvoBaro, setSalvoBaro] = useState(false);
  const [salvandoBaro, setSalvandoBaro] = useState(false);
  const [evolucao, setEvolucao] = useState(null);
  const [loadingEvo, setLoadingEvo] = useState(false);
  const [tentativaBaro, setTentativaBaro] = useState(0);

  const listaPac = (pacientes || []).map(p => `${p.nome} ${p.sobrenome || ""}`.trim());
  const pacObj = (pacientes || []).find(p => `${p.nome} ${p.sobrenome || ""}`.trim() === pacBaro);
  const historico = pacObj?.baropodometrias || [];

  // Converte o dataURL do exame de volta em arquivo para subir à nuvem
  const dataUrlParaArquivo = (dataUrl, nome) => {
    try {
      const partes = String(dataUrl).split(",");
      const mime = (partes[0].match(/data:([^;]+)/) || [])[1] || "application/octet-stream";
      const bin = atob(partes[1]); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new File([arr], nome, { type: mime });
    } catch (e) { return null; }
  };

  const salvarHistorico = async () => {
    if (!pacBaro) { setErro("Selecione o paciente para salvar no histórico."); return; }
    if (!result) return;
    setSalvandoBaro(true);
    // ☁️ Guarda na nuvem o exame original e o laudo formatado (links permanentes).
    // Se a nuvem não responder, salva mesmo assim só com o texto (como antes).
    let exameUrl = null, laudoUrl = null;
    const dataHoje = new Date().toISOString().split("T")[0];
    try {
      if (img && img.dataUrl) {
        const arq = dataUrlParaArquivo(img.dataUrl, img.nome || "exame-baro");
        if (arq) exameUrl = await STORAGE_FP.upload(arq, "baros");
      }
      const htmlLaudo = montarLaudoBaroHTML(result, dataHoje, false);
      const arqLaudo = new File([htmlLaudo], `laudo-baro-${Date.now()}.html`, { type: "text/html" });
      laudoUrl = await STORAGE_FP.upload(arqLaudo, "laudos");
    } catch (e) {}
    setPacientes(prev => prev.map(p => {
      if (`${p.nome} ${p.sobrenome || ""}`.trim() !== pacBaro) return p;
      const baros = [...(p.baropodometrias || []), { id: "BARO-" + Date.now().toString(36), data: dataHoje, result, exameUrl, exameNome: (img && img.nome) || null, laudoUrl }];
      return { ...p, baropodometrias: baros };
    }));
    setSalvandoBaro(false);
    setSalvoBaro(true);
  };

  const montarLaudoBaroHTML = (r, dataLaudo, autoPrint) => {
    const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const hoje = dataLaudo ? dataLaudo.split("-").reverse().join("/") : new Date().toLocaleDateString("pt-BR");
    const bloco = (t, v, c) => v ? `<div class="bt" style="color:${c};border-color:${c};">${esc(t)}</div><div class="bx">${esc(v)}</div>` : "";
    const exs = Array.isArray(r.exercicios) && r.exercicios.length ? `<div class="bt" style="color:#F59E0B;border-color:#F59E0B;">Exercícios recomendados</div><ol class="exs">${r.exercicios.map(e => `<li>${esc(e)}</li>`).join("")}</ol>` : "";
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Laudo Baropodométrico — ${esc(pacBaro || "Paciente")}</title>
      <style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0F172A;font-size:13px;line-height:1.65;}
      .wrap{max-width:760px;margin:0 auto;padding:40px 44px;}
      .top{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:18px;border-bottom:3px solid #3B82F6;}
      .marca{font-size:27px;font-weight:800;color:#3B82F6;letter-spacing:-.5px;line-height:1;}.marca span{color:#0F172A;}
      .sub{font-size:10px;color:#64748B;letter-spacing:.12em;margin-top:4px;font-weight:700;}
      .meta{text-align:right;font-size:12px;color:#475569;}
      .faixa{background:linear-gradient(135deg,#3B82F6,#6366F1);color:#fff;border-radius:12px;padding:16px 22px;margin:18px 0 8px;}
      .faixa .nm{font-size:18px;font-weight:800;}.faixa .sb{font-size:11px;opacity:.9;margin-top:2px;}
      .bt{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;border-left:3px solid #3B82F6;padding-left:9px;margin:18px 0 5px;}
      .bx{font-size:13px;color:#334155;padding-left:12px;}
      .exs{padding-left:30px;margin-top:4px;}.exs li{font-size:13px;color:#334155;margin-bottom:3px;}
      .ass{margin-top:54px;display:flex;justify-content:center;}
      .ass div{text-align:center;border-top:1px solid #475569;padding-top:7px;width:320px;font-size:12px;color:#475569;}
      .foot{margin-top:28px;border-top:1px solid #E2E8F0;padding-top:13px;font-size:10px;color:#94A3B8;text-align:center;}
      @media print{.wrap{padding:24px 26px;}button{display:none;}}</style></head><body><div class="wrap">
      <div class="top"><div><div class="marca">Fisio<span>Piede</span></div><div class="sub">HEALTH TECH PLATFORM</div></div>
      <div class="meta">Laudo Baropodométrico<br>Emitido em ${esc(hoje)}</div></div>
      <div class="faixa"><div class="nm">${esc(pacBaro || "Paciente")}</div><div class="sb">Análise de baropodometria por inteligência artificial</div></div>
      ${bloco("Distribuição de carga", r.distribuicao, "#3B82F6")}
      ${bloco("Picos de pressão", r.picos, "#3B82F6")}
      ${bloco("Assimetria entre os pés", r.assimetria, "#3B82F6")}
      ${bloco("Centro de pressão", r.centro_pressao, "#3B82F6")}
      ${bloco("Hipótese biomecânica", r.diagnostico, "#8B5CF6")}
      ${bloco("Prescrição de palmilha", r.prescricao, "#059669")}
      ${exs}
      <div class="ass"><div>Fisioterapeuta responsável</div></div>
      <div class="foot">FisioPiede Health Tech Platform • Laudo gerado com apoio de IA • Documento de uso clínico</div>
      </div>${autoPrint ? `<script>window.onload=function(){setTimeout(function(){window.print();},350);};<\/script>` : ""}</body></html>`;
    return html;
  };

  const gerarLaudoBaroPDF = (r, dataLaudo) => {
    if (!r) return;
    const html = montarLaudoBaroHTML(r, dataLaudo, true);
    const w = window.open("", "_blank"); if (!w) { alert("Permita pop-ups para gerar o laudo."); return; }
    w.document.open(); w.document.write(html); w.document.close();
  };

  async function compararEvolucao() {
    if (historico.length < 2) { setErro("São necessárias pelo menos 2 análises salvas para comparar a evolução."); return; }
    const permIA = podeUsarIA(clinicaId, planoIA); // comparação consome 1 análise
    if (!permIA.ok) { setErro(permIA.msg); return; }
    if (onUsoIA) onUsoIA();
    const ant = historico[historico.length - 2], rec = historico[historico.length - 1];
    setLoadingEvo(true); setErro(""); setEvolucao(null);
    try {
      const res = await fetch("/api/ia", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-opus-4-7", max_tokens: 900,
          messages: [{ role: "user", content: [{ type: "text", text: `Você é especialista em baropodometria da FisioPiede. Compare duas avaliações do MESMO paciente e descreva a EVOLUÇÃO clínica (o que melhorou, o que piorou, o que manter). Avaliação ANTERIOR (${ant.data}): ${JSON.stringify(ant.result)}. Avaliação RECENTE (${rec.data}): ${JSON.stringify(rec.result)}. Responda SOMENTE um JSON válido (sem markdown): {"resumo":"resumo geral da evolução","melhoras":"o que melhorou","pioras":"o que piorou ou ainda precisa de atenção","conduta":"ajuste de conduta/palmilha sugerido"}` }] }],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error("falha");
      let txt = (data.content || []).map(i => i.text || "").join("").replace(/```json|```/g, "").trim();
      setEvolucao(JSON.parse(txt));
    } catch (e) {
      setErro("Não foi possível comparar a evolução agora. A análise por IA requer o sistema publicado (HTTPS).");
    } finally { setLoadingEvo(false); }
  }

  const onFile = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const ehPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
    const r = new FileReader();
    r.onload = () => { setImg({ dataUrl: r.result, nome: file.name, media: file.type, ehPdf }); setResult(null); setErro(""); setSalvoBaro(false); };
    r.readAsDataURL(file);
  };

  async function analisar() {
    if (!img) return;
    const permIA = podeUsarIAqtd(clinicaId, planoIA, 5); // análise de baropodômetro consome 5
    if (!permIA.ok) { setErro(permIA.msg); return; }
    const base64 = img.dataUrl.split(",")[1] || "";
    const tamMB = (base64.length * 0.75) / (1024 * 1024);
    if (tamMB > 4) { setErro(`O arquivo está muito grande (${tamMB.toFixed(1)} MB). O limite para análise é cerca de 4 MB. Comprima o PDF, ou tire um print (imagem) da página do mapa de pressão e envie a imagem — costuma funcionar melhor.`); return; }
    setLoading(true); setErro(""); setResult(null);
    const bloco = img.ehPdf
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
      : { type: "image", source: { type: "base64", media_type: img.media || "image/jpeg", data: base64 } };
    const payload = {
      model: "claude-opus-4-7", max_tokens: 1200,
      messages: [{ role: "user", content: [
        bloco,
        { type: "text", text: `Você é especialista em baropodometria da FisioPiede. Analise este ${img.ehPdf ? "relatório de baropodometria em PDF" : "exame baropodométrico (imagem)"} e retorne SOMENTE um JSON válido (sem markdown): {"distribuicao":"análise da distribuição de carga entre retropé/antepé e pé D/E","picos":"picos de pressão e onde estão","assimetria":"análise de simetria entre os pés","centro_pressao":"análise do centro de pressão se visível","diagnostico":"hipótese biomecânica","prescricao":"elementos de palmilha recomendados (barras, cunhas, descargas)","exercicios":["exercício 1","exercício 2","exercício 3"]}` },
      ] }],
    };
    // Tenta automaticamente até 3 vezes (resolve a demora/"cold start" da primeira tentativa)
    let ultimoErro = "";
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      try {
        setTentativaBaro(tentativa);
        const res = await fetch("/api/ia", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) {
          const m = (data && data.error && data.error.message) ? data.error.message : ("Erro " + res.status);
          // erros de "arquivo grande"/4xx não adianta repetir
          if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) { setErro("Não foi possível analisar: " + m); setLoading(false); setTentativaBaro(0); return; }
          throw new Error(m);
        }
        const txt = (data.content || []).map(b => b.text || "").join("").trim();
        const mt = txt.match(/\{[\s\S]*\}/);
        setResult(JSON.parse(mt ? mt[0] : txt));
        if (onUsoIA) onUsoIA();
        setLoading(false); setTentativaBaro(0);
        return;
      } catch (e) {
        ultimoErro = (e && e.message) ? e.message : "erro";
        if (tentativa < 3) await new Promise(r => setTimeout(r, 1500 * tentativa));
      }
    }
    setErro("Não foi possível analisar após algumas tentativas (" + ultimoErro + "). Tente novamente em instantes, ou envie um print (imagem) da página do mapa de pressão. (Só funciona no site publicado.)");
    setLoading(false); setTentativaBaro(0);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card hover={false} p={20} style={{ background: `linear-gradient(135deg,${C.accent}06,${C.purple}04)`, border: `1px solid ${C.accent}18` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: `linear-gradient(135deg,${C.accent},${C.purple})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>👣</div>
          <div><div style={{ fontWeight: 800, fontSize: 15 }}>Análise de Baropodometria com IA</div><div style={{ fontSize: 12, color: C.muted }}>Envie a imagem do mapa de pressão ou o relatório em PDF</div></div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: C.sub, fontWeight: 700, marginBottom: 5 }}>Paciente (para guardar no histórico e acompanhar evolução)</div>
          <select value={pacBaro} onChange={e => { setPacBaro(e.target.value); setEvolucao(null); setSalvoBaro(false); }} style={{ width: "100%" }}>
            <option value="">Selecione o paciente...</option>
            {listaPac.map(n => <option key={n}>{n}</option>)}
          </select>
        </div>
        <label style={{ display: "block", border: `2px dashed ${img ? C.green : C.border}`, borderRadius: 11, padding: img ? 12 : 28, textAlign: "center", cursor: "pointer", color: C.muted, fontSize: 12 }}>
          <input type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={onFile} />
          {img ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {img.ehPdf
                ? <div style={{ width: 90, height: 90, borderRadius: 8, border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 34, background: `${C.red}08` }}>📄</div>
                : <img src={img.dataUrl} alt="exame" style={{ width: 90, height: 90, objectFit: "cover", borderRadius: 8, border: `1px solid ${C.border}` }} />}
              <div style={{ textAlign: "left" }}><div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{img.nome}</div><div style={{ fontSize: 11, color: C.accent }}>Clique para trocar o arquivo</div></div>
            </div>
          ) : (<><div style={{ fontSize: 30, marginBottom: 6 }}>📊</div>Clique para enviar a imagem ou o PDF do exame baropodométrico</>)}
        </label>
        {erro && <div style={{ marginTop: 12, padding: "10px 13px", background: `${C.amber}10`, border: `1px solid ${C.amber}28`, borderRadius: 8, fontSize: 12, color: C.amber }}>{erro}</div>}
        <Btn v="primary" full sz="lg" style={{ marginTop: 14 }} disabled={!img || loading} onClick={analisar}>{loading ? <><Spin sz={16} /> Analisando exame...{tentativaBaro > 1 ? ` (tentativa ${tentativaBaro})` : ""}</> : "✦ Analisar com IA (5 análises)"}</Btn>
        <div style={{marginTop:8,fontSize:10.5,color:C.muted,textAlign:"center"}}>⚠️ Cada análise de baropodômetro consome <strong style={{color:C.amber}}>5 análises</strong> da sua cota de IA.</div>
      </Card>

      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {result.diagnostico && <div style={{ padding: "12px 16px", background: `${C.purple}07`, border: `1px solid ${C.purple}25`, borderRadius: 10 }}><span style={{ fontSize: 10, color: C.purple, fontWeight: 700, textTransform: "uppercase" }}>🔬 Hipótese Biomecânica — </span><span style={{ fontSize: 13, fontWeight: 800 }}>{result.diagnostico}</span></div>}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[["📊 Distribuição de Carga", result.distribuicao, C.accent], ["🔴 Picos de Pressão", result.picos, C.red], ["⚖️ Simetria", result.assimetria, C.amber], ["🎯 Centro de Pressão", result.centro_pressao, C.purple]].map(([t, v, c]) => v && (
              <Card key={t} p={14}><div style={{ fontSize: 10, color: c, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>{t}</div><div style={{ fontSize: 12, color: C.sub, lineHeight: 1.7 }}>{v}</div></Card>
            ))}
          </div>
          {result.prescricao && <Card p={16} style={{ background: `${C.green}06`, border: `1px solid ${C.green}22` }}><div style={{ fontSize: 10, color: C.green, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>🦶 Prescrição de Palmilha Sugerida</div><div style={{ fontSize: 13, color: C.sub, lineHeight: 1.7 }}>{result.prescricao}</div></Card>}
          {result.exercicios?.length > 0 && <Card p={16}><div style={{ fontSize: 10, color: C.amber, fontWeight: 700, textTransform: "uppercase", marginBottom: 8 }}>💪 Exercícios Recomendados</div>{result.exercicios.map((ex, i) => <div key={i} style={{ display: "flex", gap: 9, padding: "6px 0", fontSize: 12, color: C.sub }}><span style={{ color: C.amber, fontWeight: 800 }}>{i + 1}.</span>{ex}</div>)}</Card>}
          <div style={{ display: "flex", gap: 8 }}>
            <Btn v={salvoBaro ? "ghost" : "primary"} sz="sm" style={{ flex: 1, justifyContent: "center" }} disabled={salvoBaro || salvandoBaro} onClick={salvarHistorico}>{salvandoBaro ? "☁️ Enviando para a nuvem..." : salvoBaro ? "✓ Salvo · exame e laudo na nuvem" : "💾 Salvar no histórico"}</Btn>
            <Btn v="outline" sz="sm" style={{ flex: 1, justifyContent: "center" }} onClick={() => gerarLaudoBaroPDF(result)}>📄 Laudo PDF</Btn>
          </div>
        </div>
      )}

      {pacBaro && historico.length > 0 && (
        <Card p={16} style={{ marginTop: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 800 }}>📈 Evolução — {pacBaro}</div>
            <span style={{ fontSize: 11, color: C.muted }}>{historico.length} análise(s)</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
            {historico.map((h, i) => (
              <div key={h.id || i} style={{ display: "flex", justifyContent: "space-between", padding: "7px 11px", background: `${C.bgGlass}`, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12 }}>
                <span style={{ color: C.text, fontWeight: 600 }}>{i + 1}. {h.data ? h.data.split("-").reverse().join("/") : "—"}</span>
                <span style={{ color: C.muted, display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
                  {h.laudoUrl && <a href={h.laudoUrl} target="_blank" rel="noreferrer" style={{ color: C.accent, fontWeight: 700, textDecoration: "none" }}>🧾 Laudo</a>}
                  {h.exameUrl && <a href={h.exameUrl} target="_blank" rel="noreferrer" style={{ color: C.green, fontWeight: 700, textDecoration: "none" }}>📎 Exame</a>}
                  <span>{h.result?.diagnostico ? String(h.result.diagnostico).slice(0, 40) : ""}</span>
                </span>
              </div>
            ))}
          </div>
          {historico.length >= 2 ? (
            <Btn v="primary" full sz="sm" disabled={loadingEvo} onClick={compararEvolucao}>{loadingEvo ? <><Spin sz={14} /> Comparando evolução...</> : "✦ Comparar evolução (2 mais recentes) com IA"}</Btn>
          ) : (
            <div style={{ fontSize: 12, color: C.muted, textAlign: "center" }}>Salve mais uma análise para comparar a evolução.</div>
          )}
          {evolucao && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[["Anterior", historico[historico.length - 2]], ["Recente", historico[historico.length - 1]]].map(([rotulo, h]) => (
                  <Card key={rotulo} p={12}>
                    <div style={{ fontSize: 10, color: C.accent, fontWeight: 800, textTransform: "uppercase", marginBottom: 5 }}>{rotulo} · {h.data ? h.data.split("-").reverse().join("/") : ""}</div>
                    <div style={{ fontSize: 11, color: C.sub, lineHeight: 1.6 }}>{h.result?.distribuicao || "—"}</div>
                  </Card>
                ))}
              </div>
              {[["📋 Resumo da evolução", evolucao.resumo, C.accent], ["✅ Melhoras", evolucao.melhoras, C.green], ["⚠️ Atenção", evolucao.pioras, C.amber], ["🦶 Ajuste de conduta", evolucao.conduta, C.purple]].map(([t, v, c]) => v && (
                <Card key={t} p={13} style={{ background: `${c}06`, border: `1px solid ${c}22` }}><div style={{ fontSize: 10, color: c, fontWeight: 700, textTransform: "uppercase", marginBottom: 5 }}>{t}</div><div style={{ fontSize: 12, color: C.sub, lineHeight: 1.7 }}>{v}</div></Card>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PAGAMENTO — geração de cobrança PIX (payload real copia-e-cola)
// ══════════════════════════════════════════════════════════════════════════════
function gerarPixPayload(chave, valor, nome, cidade, txid) {
  // Monta payload PIX EMV (BR Code) estático — padrão Banco Central
  const fmt = (id, val) => id + String(val.length).padStart(2, "0") + val;
  const nomeR = (nome || "FISIOPIEDE").slice(0, 25).toUpperCase().replace(/[^A-Z0-9 ]/g, "");
  const cidadeR = (cidade || "SAO PAULO").slice(0, 15).toUpperCase().replace(/[^A-Z0-9 ]/g, "");
  const gui = fmt("00", "br.gov.bcb.pix") + fmt("01", chave);
  const mai = fmt("26", gui);
  const valorStr = Number(valor).toFixed(2);
  let payload = fmt("00", "01") + mai + fmt("52", "0000") + fmt("53", "986") + fmt("54", valorStr) + fmt("58", "BR") + fmt("59", nomeR) + fmt("60", cidadeR) + fmt("62", fmt("05", (txid || "FP").slice(0, 25)));
  payload += "6304";
  // CRC16
  let crc = 0xFFFF;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return payload + crc.toString(16).toUpperCase().padStart(4, "0");
}

function BaixaManualModal({ clinica, valor, nPedidos, onClose, onConfirmar, onRecibo }) {
  const [forma, setForma] = useState("PIX");
  const [feito, setFeito] = useState(false);
  const FORMAS = [["PIX","⚡ PIX"],["Dinheiro","💵 Dinheiro"],["Cartão","💳 Cartão"],["Transferência","🏦 Transferência"],["Boleto","📄 Boleto"]];
  return (
    <Modal onClose={onClose}>
      <Card hover={false} p={0} style={{ width:"100%", maxWidth:440, animation:"fadeUp .25s ease" }}>
        <div style={{ padding:"18px 22px", borderBottom:`1px solid ${C.border}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div><div style={{ fontWeight:800, fontSize:15 }}>✅ Dar baixa — {clinica}</div><div style={{ fontSize:11, color:C.muted }}>{nPedidos} pedido(s) · registrar pagamento já recebido</div></div>
          <button onClick={onClose} style={{ background:"none", color:C.muted, fontSize:18 }}>✕</button>
        </div>
        <div style={{ padding:22 }}>
          {!feito ? (
            <>
              <div style={{ textAlign:"center", marginBottom:18 }}>
                <div style={{ fontSize:11, color:C.muted }}>Valor recebido</div>
                <div style={{ fontSize:34, fontWeight:900, color:C.green }}>R$ {brl(valor)}</div>
              </div>
              <div style={{ fontSize:12, fontWeight:700, color:C.sub, marginBottom:9 }}>Como a clínica pagou?</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:20 }}>
                {FORMAS.map(([id,l])=>(
                  <button key={id} onClick={()=>setForma(id)} style={{ padding:"11px", borderRadius:10, background:forma===id?`${C.green}15`:C.bgGlass, border:`1px solid ${forma===id?C.green:C.border}`, color:forma===id?C.green:C.sub, fontWeight:700, fontSize:12.5, cursor:"pointer", textAlign:"left" }}>{l}</button>
                ))}
              </div>
              <Btn v="primary" full onClick={()=>{ onConfirmar&&onConfirmar(forma); setFeito(true); }} style={{ background:C.green }}>✅ Confirmar baixa via {forma}</Btn>
              <div style={{ fontSize:10.5, color:C.muted, marginTop:10, textAlign:"center", lineHeight:1.5 }}>Use quando a clínica já pagou (em mãos, comprovante recebido, etc). O status fica <strong style={{color:C.green}}>Pago</strong> com a forma registrada.</div>
            </>
          ) : (
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:42, marginBottom:8 }}>✅</div>
              <div style={{ fontSize:15, fontWeight:800, color:C.green, marginBottom:4 }}>Baixa registrada!</div>
              <div style={{ fontSize:12, color:C.muted, marginBottom:18, lineHeight:1.6 }}>{clinica} consta como <strong style={{color:C.green}}>Pago via {forma}</strong> — R$ {brl(valor)}.</div>
              <div style={{ display:"flex", gap:8 }}>
                <Btn v="ghost" full onClick={onClose}>Fechar</Btn>
                <Btn v="primary" full onClick={()=>{ onRecibo&&onRecibo(forma); }}>🧾 Gerar recibo</Btn>
              </div>
            </div>
          )}
        </div>
      </Card>
    </Modal>
  );
}

function PagamentoModal({ clinica, valor, nPedidos, onClose, onPago }) {
  const [copiado, setCopiado] = useState(false);
  const [metodo, setMetodo] = useState("pix");
  const txid = "FP" + Date.now().toString().slice(-8);
  const pixKey = "fisiopiede@fisiopiede.com.br";
  const payload = gerarPixPayload(pixKey, valor, "FisioPiede", "Sao Paulo", txid);

  const copiar = () => {
    try { navigator.clipboard.writeText(payload); } catch (e) {}
    setCopiado(true); setTimeout(() => setCopiado(false), 2500);
  };

  return (
    <Modal onClose={onClose}>
      <Card hover={false} p={0} style={{ width: "100%", maxWidth: 460, animation: "fadeUp .25s ease" }}>
        <div style={{ padding: "18px 22px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div><div style={{ fontWeight: 800, fontSize: 15 }}>Cobrança — {clinica}</div><div style={{ fontSize: 11, color: C.muted }}>{nPedidos} pedido(s) · Fechamento mensal</div></div>
          <button onClick={onClose} style={{ background: "none", color: C.muted, fontSize: 18 }}>✕</button>
        </div>
        <div style={{ padding: 22 }}>
          <div style={{ textAlign: "center", marginBottom: 18 }}>
            <div style={{ fontSize: 11, color: C.muted }}>Valor total</div>
            <div style={{ fontSize: 34, fontWeight: 900, color: C.green }}>R$ {brl(valor)}</div>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
            {[["pix", "⚡ PIX"], ["boleto", "📄 Boleto"]].map(([id, l]) => (
              <button key={id} onClick={() => setMetodo(id)} style={{ flex: 1, padding: "9px", borderRadius: 9, background: metodo === id ? `${C.accent}15` : C.bgGlass, border: `1px solid ${metodo === id ? C.accent : C.border}`, color: metodo === id ? C.accent : C.muted, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{l}</button>
            ))}
          </div>
          {metodo === "pix" ? (
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 160, height: 160, margin: "0 auto 14px", background: "#fff", borderRadius: 12, padding: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <img alt="QR PIX" style={{ width: "100%", height: "100%" }} src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(payload)}`} />
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>Escaneie o QR Code ou use o PIX copia-e-cola:</div>
              <div style={{ padding: "10px 12px", background: C.bgGlass, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 9, fontFamily: "monospace", wordBreak: "break-all", color: C.sub, marginBottom: 10, maxHeight: 60, overflowY: "auto" }}>{payload}</div>
              <Btn v={copiado ? "primary" : "outline"} full onClick={copiar}>{copiado ? "✓ Copiado!" : "📋 Copiar código PIX"}</Btn>
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.7 }}>Boleto bancário no valor de <strong>R$ {brl(valor)}</strong>.<br />A geração de boleto registrado requer integração bancária no servidor (disponível na publicação).</div>
            </div>
          )}
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.border}`, display: "flex", gap: 8 }}>
            <Btn v="ghost" full onClick={onClose}>Fechar</Btn>
            <Btn v="primary" full onClick={() => { onPago && onPago(metodo==="boleto"?"Boleto":"PIX"); onClose(); }}>✓ Marcar como pago</Btn>
          </div>
          <div style={{ fontSize: 10, color: C.muted, textAlign: "center", marginTop: 10 }}>🔒 Chave PIX: {pixKey} · TXID: {txid}</div>
        </div>
      </Card>
    </Modal>
  );
}



// ══════════════════════════════════════════════════════════════════════════════
// FISIOPIEDE MARKETING HUB — componente
// ══════════════════════════════════════════════════════════════════════════════
function MarketingPage({ clinicaName, clinicaObj, isAdmin, clinicaId, planoIA }) {
  const [aba, setAba] = useState("dashboard");
  const [catSel, setCatSel] = useState(null);
  const [postView, setPostView] = useState(null);
  const [copiado, setCopiado] = useState("");

  // Personalização da clínica
  const cfgKey = "fp:mkt:cfg:" + (clinicaName || "default");
  const [cfg, setCfg] = useState(() => LS.read(cfgKey) || { nome: clinicaName || "Sua Clínica", whatsapp: clinicaObj?.telefone || "", endereco: "", profissional: "" });
  const salvarCfg = (c) => { setCfg(c); LS.write(cfgKey, c); };

  // Gerador IA
  const [iaTema, setIaTema] = useState("");
  const [iaTipo, setIaTipo] = useState("Post Instagram");
  const [iaLoading, setIaLoading] = useState(false);
  const [iaResult, setIaResult] = useState(null);
  // Geração de imagem por IA (DALL·E) + logo da clínica
  const [imgPrompt, setImgPrompt] = useState("");
  const [imgLoading, setImgLoading] = useState(false);
  const [imgResult, setImgResult] = useState(null);
  const [imgErro, setImgErro] = useState("");
  const [imgEstilo, setImgEstilo] = useState("Ilustração");
  const ESTILOS_IMG = {
    "Ilustração": "ilustração vetorial moderna estilo flat design premium, paleta de azuis e roxos com tons claros, formas limpas e gradientes suaves, composição minimalista elegante, qualidade de design de aplicativo profissional",
    "Foto realista": "fotografia ultrarrealista profissional, foto real de câmera DSLR, altíssima definição 4K, iluminação natural cinematográfica, profundidade de campo, cores realistas e saudáveis, estética de campanha publicitária premium — NÃO é desenho, NÃO é ilustração, NÃO é cartoon, é uma FOTOGRAFIA real",
    "Minimalista": "design minimalista premium, muito espaço em branco, pouquíssimos elementos, paleta suave de azul e branco, linhas limpas e elegantes, estilo editorial moderno de revista de saúde",
  };
  const salvarLogo = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    if (file.size > 1.5*1024*1024) { alert("A logo deve ter no máximo 1,5 MB. Use uma imagem menor."); return; }
    const r = new FileReader();
    r.onload = () => { const c = { ...cfg, logo: r.result }; salvarCfg(c); };
    r.readAsDataURL(file);
  };
  // Carimba o logo real da clínica no canto inferior direito da imagem gerada
  function carimbarLogo(imgUrl, logoUrl) {
    return new Promise((resolve, reject) => {
      try {
        const base = new Image(); base.crossOrigin = "anonymous";
        base.onload = () => {
          const cv = document.createElement("canvas");
          cv.width = base.width; cv.height = base.height;
          const ctx = cv.getContext("2d");
          ctx.drawImage(base, 0, 0);
          const logo = new Image(); logo.crossOrigin = "anonymous";
          logo.onload = () => {
            // Marca d'água sutil: logo transparente no canto inferior direito,
            // com leve sombra para legibilidade, sem selo branco (não parece colado).
            const lw = base.width * 0.13;
            const lh = logo.height * (lw / logo.width);
            const pad = base.width * 0.035;
            const x = base.width - lw - pad, y = pad; // canto superior direito
            ctx.save();
            ctx.globalAlpha = 0.38;
            ctx.shadowColor = "rgba(0,0,0,0.45)";
            ctx.shadowBlur = base.width * 0.012;
            ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
            ctx.drawImage(logo, x, y, lw, lh);
            ctx.restore();
            resolve(cv.toDataURL("image/png"));
          };
          logo.onerror = () => reject(new Error("logo"));
          logo.src = logoUrl;
        };
        base.onerror = () => reject(new Error("imagem"));
        base.src = imgUrl;
      } catch (e) { reject(e); }
    });
  }
  async function gerarImagem() {
    if (!imgPrompt.trim()) return;
    const permIA = podeUsarIAqtd(clinicaId, planoIA, 10);
    if (!permIA.ok) { setImgErro(permIA.msg); return; }
    setImgLoading(true); setImgErro(""); setImgResult(null);
    try {
      const res = await fetch("/api/imagem", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: `${ESTILOS_IMG[imgEstilo] || ESTILOS_IMG["Ilustração"]}. Tema: ${imgPrompt}. Contexto: clínica de fisioterapia e palmilhas posturais 3D, ambiente saudável e profissional. IMPORTANTE: a imagem NÃO deve conter nenhum texto, palavra, letra, número ou logotipo. Mantenha o canto superior direito mais limpo e desocupado (sem elementos importantes), pois ali será inserida a marca da clínica.` }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data && data.error && data.error.message) || ("Erro " + res.status));
      let imagemUrl = null;
      if (data.b64) imagemUrl = "data:image/png;base64," + data.b64;
      else if (data.url) imagemUrl = data.url;
      else throw new Error("imagem vazia");
      // Carimba o logo real da clínica no canto, se houver
      if (cfg.logo) {
        try { imagemUrl = await carimbarLogo(imagemUrl, cfg.logo); } catch (_) { /* se falhar, mantém a imagem sem logo */ }
      }
      setImgResult(imagemUrl);
    } catch (e) {
      setImgErro("Não foi possível gerar a imagem: " + ((e && e.message) || "erro") + ". (Requer o sistema publicado e a chave OPENAI_API_KEY configurada.)");
    }
    setImgLoading(false);
  }

  // Indicação
  const refKey = "fp:mkt:ref:" + (clinicaName || "default");
  const [refs, setRefs] = useState(() => LS.read(refKey) || []);
  // Programa FisioPiede Elite (indicação de licenciados) — visual/motivacional
  const eliteKey = "fp:elite:" + (clinicaName || "default");
  const [eliteConv, setEliteConv] = useState(() => { const v = LS.read(eliteKey); return (v && typeof v.conv==="number") ? v.conv : 0; });
  const eliteCreditos = eliteConv * 2; // 2 créditos de palmilha por indicação convertida
  const META_ELITE = [
    { n:5,  premio:"10 pares de palmilhas",  medalha:"🥈", titulo:"Embaixador Prata",   cor:"#94A3B8" },
    { n:10, premio:"25 pares + Certificação", medalha:"🥇", titulo:"Embaixador Ouro",    cor:"#F59E0B" },
    { n:25, premio:"60 pares + Destaque Nacional", medalha:"💎", titulo:"Embaixador Diamante", cor:"#22D3EE" },
  ];
  const proxMeta = META_ELITE.find(m => eliteConv < m.n) || META_ELITE[META_ELITE.length-1];
  const faltam = Math.max(0, proxMeta.n - eliteConv);
  const codigoElite = ("ELITE-" + (clinicaName||"FP").replace(/[^A-Za-z0-9]/g,"").slice(0,6).toUpperCase());
  const linkElite = ((typeof window!=="undefined" && window.location && window.location.origin) ? window.location.origin : "https://fisio-piede.vercel.app") + "/?ref=" + codigoElite;
  const gerarRef = () => {
    const codigo = (cfg.nome || "FP").replace(/[^A-Za-zÀ-ú]/g, "").slice(0, 4).toUpperCase() + Math.floor(100 + Math.random() * 900);
    const novo = { codigo, criado: Date.now(), usos: 0 };
    const n = [novo, ...refs]; setRefs(n); LS.write(refKey, n);
  };

  // Depoimentos
  const depKey = "fp:mkt:dep:" + (clinicaName || "default");
  const [deps, setDeps] = useState(() => LS.read(depKey) || []);
  const [novoDep, setNovoDep] = useState({ nome: "", texto: "", nota: 5 });
  const addDep = () => { if (!novoDep.texto.trim()) return; const n = [{ ...novoDep, id: Date.now() }, ...deps]; setDeps(n); LS.write(depKey, n); setNovoDep({ nome: "", texto: "", nota: 5 }); };

  // Conteúdos gerados e salvos (biblioteca)
  const salvosKey = "fp:mkt:salvos:" + (clinicaName || "default");
  const [salvos, setSalvos] = useState(() => LS.read(salvosKey) || []);
  const [salvoMsg, setSalvoMsg] = useState("");
  const salvarConteudo = (item) => {
    const novo = { id: Date.now(), tipo: item.tipo || iaTipo, tema: item.tema || iaTema, legenda: item.legenda || "", hashtags: item.hashtags || "", cta: item.cta || "", roteiro: item.roteiro || "", img: item.img || null, data: new Date().toLocaleDateString("pt-BR") };
    const n = [novo, ...salvos]; setSalvos(n); LS.write(salvosKey, n);
    setSalvoMsg("✓ Salvo em Campanhas!"); setTimeout(() => setSalvoMsg(""), 2500);
  };
  const excluirSalvo = (id) => { const n = salvos.filter(s => s.id !== id); setSalvos(n); LS.write(salvosKey, n); };

  useEffect(() => {
    (async () => {
      const c = await LS.readAsync(cfgKey); if (c) setCfg(c);
      const r = await LS.readAsync(refKey); if (r) setRefs(r);
      const d = await LS.readAsync(depKey); if (d) setDeps(d);
      const s = await LS.readAsync(salvosKey); if (s) setSalvos(s);
    })();
  }, []);

  const copiar = (txt, id) => { try { navigator.clipboard.writeText(txt); } catch (e) {} setCopiado(id); setTimeout(() => setCopiado(""), 2000); };
  const waLink = (txt) => `https://wa.me/?text=${encodeURIComponent(txt)}`;
  const assinatura = `\n\n📍 ${cfg.nome}${cfg.endereco ? " — " + cfg.endereco : ""}${cfg.whatsapp ? "\n📱 " + cfg.whatsapp : ""}`;

  async function gerarIA() {
    if (!iaTema.trim()) return;
    const permIA = podeUsarIA(clinicaId, planoIA);
    if (!permIA.ok) { setIaResult({ erro: permIA.msg }); return; }
    setIaLoading(true); setIaResult(null);
    let ok = false;
    try {
      const res = await fetch("/api/ia", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-opus-4-7", max_tokens: 1000,
          messages: [{ role: "user", content: `Você é especialista em marketing para clínicas de fisioterapia e palmilhas posturais (FisioPiede). Crie um ${iaTipo} sobre "${iaTema}". Retorne SOMENTE JSON válido (sem markdown): {"legenda":"texto envolvente com emojis","hashtags":"#tag1 #tag2 ...","cta":"chamada para ação curta","roteiro":"se for vídeo/reels, roteiro em tópicos; senão string vazia"}` }],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const txt = (data.content || []).map(b => b.text || "").join("").trim();
        const m = txt.match(/\{[\s\S]*\}/);
        if (m) { setIaResult(JSON.parse(m[0])); ok = true; }
      }
    } catch (e) { }
    if (!ok) {
      // Fallback local — template inteligente
      setIaResult({
        legenda: `${iaTema} 🦶\n\nVocê sabia que cuidar dos seus pés transforma sua qualidade de vida? Na ${cfg.nome}, oferecemos avaliação completa e palmilhas posturais 3D personalizadas.\n\nNão conviva com a dor — dê o primeiro passo para o bem-estar!`,
        hashtags: "#fisioterapia #palmilhasposturais #saudedospes #qualidadedevida #bemestar #fisiopiede",
        cta: "Agende sua avaliação hoje!",
        roteiro: iaTipo.includes("Vídeo") || iaTipo.includes("Reels") ? `1. Abertura: pergunta que chama atenção sobre ${iaTema}\n2. Problema: o que causa e os sintomas\n3. Solução: avaliação + palmilhas posturais 3D\n4. CTA: convite para agendar` : "",
      });
    }
    setIaLoading(false);
  }

  const ABAS = [
    { id: "dashboard", icon: "⬡", label: "Dashboard" },
    { id: "biblioteca", icon: "🖼️", label: "Biblioteca" },
    { id: "ia", icon: "✦", label: "Gerador IA" },
    { id: "modelos", icon: "📚", label: "Modelos" },
    { id: "campanhas", icon: "📣", label: "Campanhas" },
    { id: "calendario", icon: "📅", label: "Calendário" },
    { id: "indicacao", icon: "🤝", label: "Indicação" },
    { id: "elite", icon: "👑", label: "Elite" },
    { id: "depoimentos", icon: "⭐", label: "Depoimentos" },
    { id: "config", icon: "⚙", label: "Personalizar" },
  ];

  // Preview de post Instagram
  const InstaPreview = ({ post, cat }) => (
    <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", border: `1px solid ${C.border}`, maxWidth: 360, color: "#000" }}>
      <div style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid #eee" }}>
        <div style={{ width: 30, height: 30, borderRadius: "50%", background: `linear-gradient(135deg,${C.accent},${C.purple})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#fff", fontWeight: 800 }}>{(cfg.nome || "F").charAt(0)}</div>
        <div style={{ fontSize: 12, fontWeight: 700 }}>{cfg.nome || "Sua Clínica"}</div>
        <span style={{ marginLeft: "auto", color: "#888" }}>•••</span>
      </div>
      <div style={{ aspectRatio: "1", background: `linear-gradient(135deg,${cat?.cor || C.accent},${C.purple})`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>{cat?.icon || "🦶"}</div>
        <div style={{ fontSize: 20, fontWeight: 900, color: "#fff", lineHeight: 1.2 }}>{post.titulo}</div>
        <div style={{ marginTop: 14, padding: "6px 14px", background: "rgba(255,255,255,.2)", borderRadius: 99, fontSize: 11, color: "#fff", fontWeight: 700 }}>FISIOPIEDE</div>
      </div>
      <div style={{ padding: "10px 12px" }}>
        <div style={{ display: "flex", gap: 12, fontSize: 18, marginBottom: 8 }}><span>❤️</span><span>💬</span><span>📤</span><span style={{ marginLeft: "auto" }}>🔖</span></div>
        <div style={{ fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap", color: "#222" }}><strong>{cfg.nome || "suaclinica"}</strong> {post.legenda}</div>
        <div style={{ fontSize: 12, color: "#3B5998", marginTop: 6 }}>{post.hashtags}</div>
      </div>
    </div>
  );

  return (
    <div style={{ padding: 20 }}>
      <SH title="Marketing Hub 📣" sub="Central de marketing, captação e crescimento da sua clínica" />
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, marginBottom: 20, overflowX: "auto" }}>
        {ABAS.map(a => { const at = aba === a.id; return (
          <button key={a.id} onClick={() => { setAba(a.id); setCatSel(null); setPostView(null); }} style={{ padding: "10px 16px", fontSize: 13, fontWeight: at ? 700 : 500, color: at ? C.accent : C.muted, background: "none", borderBottom: at ? `2px solid ${C.accent}` : "2px solid transparent", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}><span>{a.icon}</span>{a.label}</button>
        ); })}
      </div>

      {/* DASHBOARD */}
      {aba === "dashboard" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 11 }}>
            {[["🖼️", "Materiais prontos", Object.values(MKT_POSTS).flat().length + "+"], ["📣", "Campanhas", MKT_CAMPANHAS.length], ["🤝", "Códigos de indicação", refs.length], ["⭐", "Depoimentos", deps.length]].map(([i, l, v], idx) => (
              <Card key={idx} p={16} style={{ textAlign: "center" }}><div style={{ fontSize: 22, marginBottom: 6 }}>{i}</div><div style={{ fontSize: 20, fontWeight: 900 }}>{v}</div><div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>{l}</div></Card>
            ))}
          </div>
          <Card hover={false} p={20} style={{ background: `linear-gradient(135deg,${C.accent}10,${C.purple}06)`, border: `1px solid ${C.accent}22` }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 6 }}>✦ Gerador de Conteúdo com IA</div>
            <div style={{ fontSize: 12, color: C.sub, marginBottom: 12 }}>Crie posts, legendas e roteiros profissionais em segundos. É só pedir o tema.</div>
            <Btn v="primary" onClick={() => setAba("ia")}>Criar conteúdo agora →</Btn>
          </Card>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 10 }}>📅 Sugestões para este mês</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 10 }}>
              {MKT_CAMPANHAS.slice(0, 4).map((c, i) => (
                <Card key={i} p={14} style={{ cursor: "pointer", border: `1px solid ${c.cor}25` }} onClick={() => setAba("campanhas")}>
                  <div style={{ fontSize: 22 }}>{c.icon}</div>
                  <div style={{ fontWeight: 700, fontSize: 13, marginTop: 6 }}>{c.nome}</div>
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{c.mes} · {c.tipo}</div>
                </Card>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* BIBLIOTECA */}
      {aba === "biblioteca" && (
        <div>
          {postView ? (
            <div>
              <button onClick={() => setPostView(null)} style={{ background: "none", color: C.muted, fontSize: 12, marginBottom: 14 }}>← Voltar à biblioteca</button>
              <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 20 }}>
                <InstaPreview post={postView.post} cat={postView.cat} />
                <div>
                  <Badge label={postView.post.tipo} color={postView.cat.cor} />
                  <div style={{ fontSize: 18, fontWeight: 900, margin: "10px 0 16px" }}>{postView.post.titulo}</div>
                  <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Legenda</div>
                  <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.7, whiteSpace: "pre-wrap", padding: 12, background: C.bgGlass, borderRadius: 9, border: `1px solid ${C.border}`, marginBottom: 8 }}>{postView.post.legenda}{assinatura}</div>
                  <div style={{ fontSize: 12, color: C.accent, marginBottom: 14 }}>{postView.post.hashtags}</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Btn v="primary" onClick={() => copiar(postView.post.legenda + assinatura + "\n\n" + postView.post.hashtags, "post")}>{copiado === "post" ? "✓ Copiado!" : "📋 Copiar tudo"}</Btn>
                    <a href={waLink(postView.post.legenda + assinatura)} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}><Btn v="outline">📱 Enviar no WhatsApp</Btn></a>
                  </div>
                </div>
              </div>
            </div>
          ) : catSel ? (
            <div>
              <button onClick={() => setCatSel(null)} style={{ background: "none", color: C.muted, fontSize: 12, marginBottom: 14 }}>← Todas as categorias</button>
              <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 14 }}>{catSel.icon} {catSel.nome}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 12 }}>
                {(MKT_POSTS[catSel.nome] || []).length > 0 ? (MKT_POSTS[catSel.nome]).map((p, i) => (
                  <Card key={i} p={0} style={{ overflow: "hidden", cursor: "pointer" }} onClick={() => setPostView({ post: p, cat: catSel })}>
                    <div style={{ aspectRatio: "1.4", background: `linear-gradient(135deg,${catSel.cor},${C.purple})`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 16, textAlign: "center" }}>
                      <div style={{ fontSize: 30, marginBottom: 8 }}>{catSel.icon}</div>
                      <div style={{ fontSize: 15, fontWeight: 900, color: "#fff" }}>{p.titulo}</div>
                    </div>
                    <div style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}><Badge label={p.tipo} color={catSel.cor} /><span style={{ fontSize: 11, color: C.accent, fontWeight: 700 }}>Ver →</span></div>
                  </Card>
                )) : <div style={{ color: C.muted, fontSize: 13, padding: 20 }}>🔜 Materiais desta categoria em breve. Use o Gerador IA para criar agora!</div>}
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))", gap: 12 }}>
              {MKT_CATEGORIAS.map((cat, i) => (
                <Card key={i} p={18} style={{ textAlign: "center", cursor: "pointer", border: `1px solid ${cat.cor}20` }} onClick={() => setCatSel(cat)}>
                  <div style={{ width: 48, height: 48, borderRadius: 13, background: `${cat.cor}18`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, margin: "0 auto 10px" }}>{cat.icon}</div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{cat.nome}</div>
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>{(MKT_POSTS[cat.nome] || []).length} materiais</div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* GERADOR IA */}
      {aba === "ia" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Card hover={false} p={20}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 14 }}>✦ Gerador de Conteúdo</div>
            <label>Tipo de material</label>
            <select value={iaTipo} onChange={e => setIaTipo(e.target.value)}>
              {["Post Instagram", "Carrossel", "Stories", "Reels (roteiro)", "Vídeo (roteiro)", "Texto WhatsApp", "Texto promocional"].map(t => <option key={t}>{t}</option>)}
            </select>
            <label style={{ marginTop: 12, display: "block" }}>Tema / assunto</label>
            <input value={iaTema} onChange={e => setIaTema(e.target.value)} placeholder="Ex: fascite plantar, corrida, postura..." />
            <Btn v="primary" full sz="lg" style={{ marginTop: 14 }} disabled={iaLoading || !iaTema.trim()} onClick={gerarIA}>{iaLoading ? <><Spin sz={16} /> Gerando...</> : "✦ Gerar conteúdo"}</Btn>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 10, lineHeight: 1.5 }}>💡 A IA cria legenda, hashtags, CTA e roteiro. Funciona com modelos profissionais mesmo offline.</div>
          </Card>
          <Card hover={false} p={20}>
            {iaResult && iaResult.erro ? (
              <div style={{ padding: 16, textAlign: "center" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
                <div style={{ fontSize: 13, color: C.amber, lineHeight: 1.6 }}>{iaResult.erro}</div>
              </div>
            ) : iaResult ? (
              <div>
                <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 12 }}>Resultado</div>
                <div style={{ fontSize: 10, color: C.accent, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Legenda</div>
                <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.7, whiteSpace: "pre-wrap", padding: 10, background: C.bgGlass, borderRadius: 8, marginBottom: 10 }}>{iaResult.legenda}{assinatura}</div>
                {iaResult.hashtags && <><div style={{ fontSize: 10, color: C.accent, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Hashtags</div><div style={{ fontSize: 12, color: C.purple, marginBottom: 10 }}>{iaResult.hashtags}</div></>}
                {iaResult.cta && <><div style={{ fontSize: 10, color: C.accent, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Chamada para ação</div><div style={{ fontSize: 13, color: C.sub, fontWeight: 600, marginBottom: 10 }}>{iaResult.cta}</div></>}
                {iaResult.roteiro && <><div style={{ fontSize: 10, color: C.accent, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Roteiro</div><div style={{ fontSize: 12, color: C.sub, lineHeight: 1.7, whiteSpace: "pre-wrap", marginBottom: 10 }}>{iaResult.roteiro}</div></>}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Btn v="primary" sz="sm" onClick={() => copiar(iaResult.legenda + assinatura + "\n\n" + (iaResult.hashtags || ""), "ia")}>{copiado === "ia" ? "✓ Copiado!" : "📋 Copiar"}</Btn>
                  <a href={waLink(iaResult.legenda + assinatura)} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}><Btn v="outline" sz="sm">📱 WhatsApp</Btn></a>
                  <Btn v="outline" sz="sm" onClick={() => salvarConteudo({ ...iaResult, tipo: iaTipo, tema: iaTema })}>💾 Salvar em Campanhas</Btn>
                </div>
                {salvoMsg && <div style={{ fontSize: 11, color: C.green, marginTop: 6, fontWeight: 600 }}>{salvoMsg}</div>}
              </div>
            ) : <div style={{ textAlign: "center", color: C.muted, fontSize: 12, marginTop: 60 }}><div style={{ fontSize: 36, marginBottom: 10 }}>✦</div>O conteúdo gerado aparecerá aqui.</div>}
          </Card>
          {/* Logo da clínica + Geração de imagem por IA */}
          <Card hover={false} p={20}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>🖼️ Logo da clínica</div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>Cadastre a logo da sua clínica para usar nos materiais.</div>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 72, height: 72, borderRadius: 12, border: `1px solid ${C.border}`, background: C.bgGlass, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
                {cfg.logo ? <img src={cfg.logo} alt="logo" style={{ maxWidth: "100%", maxHeight: "100%" }} /> : <span style={{ fontSize: 22, color: C.muted }}>🏥</span>}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ cursor: "pointer" }}><input type="file" accept="image/*" style={{ display: "none" }} onChange={salvarLogo} /><span style={{ display: "inline-block", padding: "8px 14px", background: C.accent, color: "#fff", borderRadius: 8, fontSize: 12, fontWeight: 700 }}>{cfg.logo ? "Trocar logo" : "Enviar logo"}</span></label>
                {cfg.logo && <button onClick={() => salvarCfg({ ...cfg, logo: null })} style={{ background: "none", color: C.red, fontSize: 11, cursor: "pointer", border: "none", textAlign: "left" }}>Remover</button>}
                <span style={{ fontSize: 10, color: C.muted }}>PNG/JPG até 1,5 MB</span>
              </div>
            </div>
          </Card>
          <Card hover={false} p={20}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>🎨 Gerar imagem com IA</div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>Descreva a imagem para o seu post. A IA cria uma ilustração{cfg.logo ? " e adiciona o seu logo como marca d'água no canto superior direito" : ""}. <strong style={{color:C.amber}}>⚠️ Cada imagem gerada consome 10 análises da sua cota</strong>.{!cfg.logo ? " Cadastre sua logo acima para que ela apareça nas imagens." : ""}</div>
            <div style={{ fontSize: 10.5, color: C.sub, fontWeight: 700, marginBottom: 6, textTransform: "uppercase", letterSpacing: ".04em" }}>Estilo da imagem</div>
            <div style={{ display: "flex", gap: 7, marginBottom: 11, flexWrap: "wrap" }}>
              {Object.keys(ESTILOS_IMG).map(est => (
                <button key={est} onClick={() => setImgEstilo(est)} style={{ padding: "7px 14px", borderRadius: 99, border: `1px solid ${imgEstilo === est ? C.purple : C.border}`, background: imgEstilo === est ? `${C.purple}18` : "transparent", color: imgEstilo === est ? C.purple : C.sub, fontWeight: 700, fontSize: 11.5, cursor: "pointer", transition: "all .15s" }}>{est}</button>
              ))}
            </div>
            <textarea value={imgPrompt} onChange={e => setImgPrompt(e.target.value)} rows={3} placeholder="Ex: paciente sorrindo durante uma sessão de fisioterapia em um consultório moderno e clean, luz natural suave, ambiente acolhedor e profissional" style={{ width: "100%", fontSize: 12, lineHeight: 1.6, resize: "vertical", marginBottom: 10 }} />
            <Btn v="primary" full disabled={imgLoading || !imgPrompt.trim()} onClick={gerarImagem} style={{ background: C.purple }}>{imgLoading ? <><Spin sz={14} /> Gerando imagem (aguarde ~15-30s)...</> : "🎨 Gerar imagem (10 análises)"}</Btn>
            {imgErro && <div style={{ marginTop: 10, padding: "9px 13px", background: `${C.amber}10`, border: `1px solid ${C.amber}28`, borderRadius: 8, fontSize: 11.5, color: C.amber }}>{imgErro}</div>}
            {imgResult && (
              <div style={{ marginTop: 12 }}>
                <img src={imgResult} alt="imagem gerada" style={{ width: "100%", borderRadius: 10, border: `1px solid ${C.border}` }} />
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <a href={imgResult} download="fisiopiede-marketing.png" style={{ textDecoration: "none", flex: 1 }}><Btn v="outline" sz="sm" full style={{ justifyContent: "center" }}>⬇️ Baixar</Btn></a>
                  <Btn v="outline" sz="sm" style={{ flex: 1, justifyContent: "center" }} onClick={() => salvarConteudo({ tipo: "Imagem", tema: imgPrompt, img: imgResult })}>💾 Salvar</Btn>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* CAMPANHAS */}
      {/* MODELOS POR PATOLOGIA */}
      {aba === "modelos" && (
        <div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>📚 Modelos de Marketing por Patologia</div>
            <div style={{ fontSize: 11.5, color: C.muted, marginTop: 3, lineHeight: 1.5, maxWidth: 560 }}>Conteúdo profissional pronto para cada patologia. Clique em <strong>"Usar imagem"</strong> para levar o comando ao gerador, e em <strong>"Copiar legenda"</strong> para o texto do post.</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(330px,1fr))", gap: 12 }}>
            {MKT_MODELOS.map((m, i) => (
              <Card key={i} p={16} style={{ border: `1px solid ${C.accent}20` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 22 }}>{m.icon}</span>
                  <span style={{ fontSize: 14, fontWeight: 800 }}>{m.pat}</span>
                </div>
                <div style={{ fontSize: 10, color: C.purple, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 4 }}>🎨 Prompt da imagem</div>
                <div style={{ fontSize: 11.5, color: C.sub, lineHeight: 1.5, marginBottom: 8, background: C.bgGlass, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px" }}>{m.promptImg}</div>
                <div style={{ fontSize: 10, color: C.purple, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 4 }}>✍️ Legenda do post</div>
                <div style={{ fontSize: 11.5, color: C.sub, lineHeight: 1.6, marginBottom: 10, whiteSpace: "pre-wrap", maxHeight: 150, overflow: "auto", background: C.bgGlass, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px" }}>{m.legenda}</div>
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                  <Btn v="primary" sz="sm" style={{ background: C.purple }} onClick={() => { setImgPrompt(m.promptImg); setImgEstilo("Foto realista"); setAba("ia"); }}>🎨 Usar imagem</Btn>
                  <Btn v="outline" sz="sm" onClick={() => copiar(m.legenda + assinatura, "mod" + i)}>{copiado === "mod" + i ? "✓ Copiado!" : "📋 Copiar legenda"}</Btn>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {aba === "campanhas" && (
        <div>
          {/* Meus conteúdos salvos */}
          <div style={{ marginBottom: 22 }}>
            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>💾 Meus conteúdos salvos</div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>Tudo que você gera no Gerador IA e salva aparece aqui.</div>
            {salvos.length === 0 ? (
              <Card hover={false} p={24} style={{ textAlign: "center", color: C.muted }}><div style={{ fontSize: 30, marginBottom: 8 }}>📭</div><div style={{ fontSize: 13 }}>Nenhum conteúdo salvo ainda. Gere conteúdo no <strong>Gerador IA</strong> e clique em "Salvar em Campanhas".</div></Card>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12 }}>
                {salvos.map((s) => (
                  <Card key={s.id} p={0} style={{ overflow: "hidden", border: `1px solid ${C.accent}25` }}>
                    {s.img && <img src={s.img} alt="" style={{ width: "100%", display: "block" }} />}
                    <div style={{ padding: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <Badge label={s.tipo} color={C.accent} />
                        <span style={{ fontSize: 10, color: C.muted }}>{s.data}</span>
                      </div>
                      {s.tema && <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 5 }}>{s.tema}</div>}
                      {s.legenda && <div style={{ fontSize: 11.5, color: C.sub, lineHeight: 1.6, whiteSpace: "pre-wrap", maxHeight: 110, overflow: "hidden", marginBottom: 6 }}>{s.legenda}</div>}
                      {s.hashtags && <div style={{ fontSize: 11, color: C.purple, marginBottom: 8 }}>{s.hashtags}</div>}
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {s.legenda && <Btn v="primary" sz="sm" onClick={() => copiar(s.legenda + assinatura + "\n\n" + (s.hashtags || ""), "sv" + s.id)}>{copiado === "sv" + s.id ? "✓" : "📋 Copiar"}</Btn>}
                        {s.img && <a href={s.img} download="fisiopiede.png" style={{ textDecoration: "none" }}><Btn v="outline" sz="sm">⬇️</Btn></a>}
                        <Btn v="ghost" sz="sm" onClick={() => excluirSalvo(s.id)} style={{ color: C.red }}>🗑️</Btn>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
          {/* Campanhas prontas */}
          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 12 }}>📣 Campanhas prontas</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12 }}>
          {MKT_CAMPANHAS.map((c, i) => (
            <Card key={i} p={0} style={{ overflow: "hidden", border: `1px solid ${c.cor}25` }}>
              <div style={{ padding: 16, background: `linear-gradient(135deg,${c.cor}18,${c.cor}06)` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}><span style={{ fontSize: 28 }}>{c.icon}</span><Badge label={c.tipo} color={c.cor} /></div>
                <div style={{ fontWeight: 800, fontSize: 15, marginTop: 8 }}>{c.nome}</div>
                <div style={{ fontSize: 10, color: C.muted }}>{c.mes}</div>
              </div>
              <div style={{ padding: 14 }}>
                <div style={{ fontSize: 12, color: C.sub, lineHeight: 1.6, marginBottom: 10 }}>{c.desc}</div>
                <div style={{ fontSize: 12, color: C.sub, lineHeight: 1.6, padding: 10, background: C.bgGlass, borderRadius: 8, marginBottom: 10, fontStyle: "italic" }}>"{c.copy}"</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <Btn v="primary" sz="sm" onClick={() => copiar(c.copy + assinatura, "camp" + i)}>{copiado === "camp" + i ? "✓" : "📋 Copiar"}</Btn>
                  <a href={waLink(c.copy + assinatura)} target="_blank" rel="noreferrer" style={{ textDecoration: "none", flex: 1 }}><Btn v="outline" sz="sm" full style={{ justifyContent: "center" }}>📱 WhatsApp</Btn></a>
                </div>
              </div>
            </Card>
          ))}
          </div>
        </div>
      )}

      {/* CALENDÁRIO */}
      {aba === "calendario" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 12 }}>
          {MKT_CALENDARIO.map((m, i) => { const atual = new Date().getMonth() === i; return (
            <Card key={i} p={16} style={{ border: atual ? `1px solid ${C.accent}40` : `1px solid ${C.border}`, background: atual ? `${C.accent}06` : C.bgCard }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}><div style={{ fontWeight: 800, fontSize: 14 }}>{m.mes}</div>{atual && <Badge label="Atual" color={C.accent} />}</div>
              {m.datas.map((d, j) => (
                <div key={j} style={{ display: "flex", gap: 8, padding: "6px 0", borderBottom: j < m.datas.length - 1 ? `1px solid ${C.border}` : "none" }}>
                  <span style={{ fontSize: 10, color: C.accent, fontWeight: 700, minWidth: 54 }}>{d.d}</span>
                  <span style={{ fontSize: 11, color: C.sub }}>{d.ev}</span>
                </div>
              ))}
            </Card>
          ); })}
        </div>
      )}

      {/* INDICAÇÃO */}
      {aba === "indicacao" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card hover={false} p={20} style={{ background: `linear-gradient(135deg,${C.purple}10,${C.accent}06)`, border: `1px solid ${C.purple}22` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <div><div style={{ fontWeight: 800, fontSize: 15 }}>🤝 Programa Indique um Amigo</div><div style={{ fontSize: 12, color: C.sub, marginTop: 4 }}>Gere códigos de indicação e acompanhe os resultados.</div></div>
              <Btn v="primary" onClick={gerarRef}>+ Gerar código</Btn>
            </div>
          </Card>
          {refs.length === 0 ? (
            <Card p={30} style={{ textAlign: "center", color: C.muted }}><div style={{ fontSize: 36, marginBottom: 10 }}>🤝</div>Nenhum código ainda. Gere o primeiro!</Card>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 12 }}>
              {refs.map((r, i) => (
                <Card key={i} p={16}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}><Badge label={`${r.usos} uso(s)`} color={C.green} /><span style={{ fontSize: 10, color: C.muted }}>{new Date(r.criado).toLocaleDateString("pt-BR")}</span></div>
                  <div style={{ fontSize: 22, fontWeight: 900, fontFamily: "monospace", color: C.accent, letterSpacing: ".05em", textAlign: "center", padding: "10px 0" }}>{r.codigo}</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <Btn v="outline" sz="sm" full style={{ justifyContent: "center" }} onClick={() => copiar(`Use meu código ${r.codigo} e ganhe benefícios na sua avaliação na ${cfg.nome}! 🤝`, "ref" + i)}>{copiado === "ref" + i ? "✓" : "📋"}</Btn>
                    <Btn v="ghost" sz="sm" full style={{ justifyContent: "center" }} onClick={() => { const n = refs.map((x, j) => j === i ? { ...x, usos: x.usos + 1 } : x); setRefs(n); LS.write(refKey, n); }}>+1 uso</Btn>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* PROGRAMA FISIOPIEDE ELITE */}
      {aba === "elite" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Hero */}
          <Card hover={false} p={0} style={{ overflow: "hidden", border: `1px solid ${C.gold}30` }}>
            <div style={{ padding: 24, background: `linear-gradient(135deg,${C.gold}1A,${C.purple}10,${C.accent}08)`, position: "relative" }}>
              <div style={{ position: "absolute", top: -30, right: -10, fontSize: 120, opacity: 0.08 }}>👑</div>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".2em", color: C.gold, textTransform: "uppercase" }}>FisioPiede</div>
              <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: "-.5px", marginTop: 2 }}>Programa Elite 👑</div>
              <div style={{ fontSize: 12.5, color: C.sub, marginTop: 6, maxWidth: 460, lineHeight: 1.5 }}>Indique colegas para o Plano Enterprise e ganhe créditos de palmilhas. Quanto mais você cresce a rede, maiores as recompensas.</div>
            </div>
          </Card>

          {/* Carteira + progresso */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Card p={0} style={{ overflow: "hidden" }}>
              <div style={{ height: 3, background: `linear-gradient(90deg,${C.green},${C.green}55)` }} />
              <div style={{ padding: 18 }}>
                <div style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>💳 Carteira de créditos</div>
                <div style={{ fontSize: 34, fontWeight: 900, color: C.green, letterSpacing: "-1px", textShadow: `0 0 22px ${C.green}30`, marginTop: 4 }}>{eliteCreditos}</div>
                <div style={{ fontSize: 11.5, color: C.sub }}>pares de palmilha em crédito</div>
                <div style={{ fontSize: 10.5, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>{eliteConv} indicação(ões) convertida(s) · 2 créditos cada</div>
              </div>
            </Card>
            <Card p={0} style={{ overflow: "hidden" }}>
              <div style={{ height: 3, background: `linear-gradient(90deg,${proxMeta.cor},${proxMeta.cor}55)` }} />
              <div style={{ padding: 18 }}>
                <div style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>🎯 Próxima meta</div>
                <div style={{ fontSize: 14, fontWeight: 800, marginTop: 4 }}>{proxMeta.medalha} {proxMeta.titulo}</div>
                {faltam > 0
                  ? <div style={{ fontSize: 12, color: proxMeta.cor, fontWeight: 700, marginTop: 3 }}>Faltam {faltam} para ganhar {proxMeta.premio}!</div>
                  : <div style={{ fontSize: 12, color: C.green, fontWeight: 700, marginTop: 3 }}>Meta máxima atingida! 🎉</div>}
                <div style={{ marginTop: 10, height: 8, background: C.bgGlass, borderRadius: 99, overflow: "hidden", border: `1px solid ${C.border}` }}>
                  <div style={{ height: "100%", width: `${Math.min(100, (eliteConv/proxMeta.n)*100)}%`, background: `linear-gradient(90deg,${proxMeta.cor},${proxMeta.cor}aa)`, borderRadius: 99, transition: "width .5s" }} />
                </div>
                <div style={{ fontSize: 10, color: C.muted, marginTop: 5 }}>{eliteConv} de {proxMeta.n} indicações</div>
              </div>
            </Card>
          </div>

          {/* Metas de embaixador */}
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 10 }}>🏆 Metas de Embaixador</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
              {META_ELITE.map((m, i) => { const ating = eliteConv >= m.n; return (
                <Card key={i} p={0} style={{ overflow: "hidden", border: ating ? `1.5px solid ${m.cor}` : `1px solid ${C.border}`, opacity: ating ? 1 : 0.85, position: "relative" }}>
                  <div style={{ height: 3, background: ating ? m.cor : C.border }} />
                  <div style={{ padding: 16, textAlign: "center" }}>
                    <div style={{ fontSize: 34, marginBottom: 6, filter: ating ? "none" : "grayscale(1)" }}>{m.medalha}</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: ating ? m.cor : C.text }}>{m.titulo}</div>
                    <div style={{ fontSize: 11, color: C.muted, margin: "4px 0 8px" }}>{m.n} licenciados Enterprise</div>
                    <div style={{ fontSize: 11.5, color: C.sub, fontWeight: 600, lineHeight: 1.4 }}>🎁 {m.premio}</div>
                    {ating && <div style={{ marginTop: 8, fontSize: 10, fontWeight: 800, color: m.cor, background: `${m.cor}18`, padding: "3px 10px", borderRadius: 99, display: "inline-block" }}>✓ CONQUISTADO</div>}
                  </div>
                </Card>
              ); })}
            </div>
          </div>

          {/* Seu código + como funciona */}
          <Card hover={false} p={20} style={{ background: `linear-gradient(135deg,${C.accent}08,${C.purple}06)`, border: `1px solid ${C.accent}22` }}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>🔗 Seu código de indicação</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontSize: 20, fontWeight: 900, fontFamily: "monospace", color: C.accent, letterSpacing: ".08em", background: C.bgCard, border: `1px solid ${C.accent}30`, borderRadius: 8, padding: "8px 16px" }}>{codigoElite}</div>
              <Btn v="primary" sz="sm" onClick={() => copiar(`Conheça a FisioPiede e ative seu Plano Enterprise! Cadastre-se pelo meu link de indicação: ${linkElite} 👑🦶`, "elitecod")}>{copiado === "elitecod" ? "✓ Copiado!" : "📋 Copiar convite"}</Btn>
              <Btn v="gold" sz="sm" onClick={() => copiar(linkElite, "elitelink")}>{copiado === "elitelink" ? "✓ Link copiado!" : "🔗 Copiar link de indicação"}</Btn>
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: C.sub, fontFamily: "'Space Mono',monospace", background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 8, padding: "7px 12px", wordBreak: "break-all" }}>{linkElite}</div>
            <div style={{ marginTop: 6, fontSize: 10.5, color: C.muted }}>✨ Quem abrir seu link cai direto no cadastro com o seu código já preenchido e travado — sem precisar digitar nada.</div>
            <div style={{ marginTop: 14, fontSize: 11.5, color: C.sub, lineHeight: 1.7 }}>
              <strong style={{ color: C.text }}>Como funciona:</strong><br/>
              1️⃣ Compartilhe seu link de indicação com colegas de outras clínicas<br/>
              2️⃣ Quando eles ativarem o Plano Enterprise, conta como indicação convertida<br/>
              3️⃣ Você ganha 2 créditos de palmilha por indicação + bônus ao bater metas<br/>
              4️⃣ Use os créditos para solicitar palmilhas ou abater cobranças
            </div>
          </Card>

          <div style={{ fontSize: 10.5, color: C.muted, fontStyle: "italic", textAlign: "center" }}>As indicações convertidas e os créditos são confirmados pela equipe FisioPiede. Em breve, acompanhamento automático.</div>
        </div>
      )}

      {/* DEPOIMENTOS */}
      {aba === "depoimentos" && (
        <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16 }}>
          <Card hover={false} p={18}>
            <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 12 }}>+ Novo depoimento</div>
            <label>Nome do paciente</label>
            <input value={novoDep.nome} onChange={e => setNovoDep({ ...novoDep, nome: e.target.value })} placeholder="Ex: Maria S." />
            <label style={{ marginTop: 10, display: "block" }}>Depoimento</label>
            <textarea rows={4} value={novoDep.texto} onChange={e => setNovoDep({ ...novoDep, texto: e.target.value })} placeholder="O que o paciente disse..." />
            <label style={{ marginTop: 10, display: "block" }}>Nota</label>
            <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>{[1, 2, 3, 4, 5].map(n => <button key={n} onClick={() => setNovoDep({ ...novoDep, nota: n })} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", opacity: n <= novoDep.nota ? 1 : .3 }}>⭐</button>)}</div>
            <Btn v="primary" full onClick={addDep}>Salvar depoimento</Btn>
          </Card>
          <div>
            {deps.length === 0 ? (
              <Card p={30} style={{ textAlign: "center", color: C.muted }}><div style={{ fontSize: 36, marginBottom: 10 }}>⭐</div>Nenhum depoimento ainda.</Card>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 12 }}>
                {deps.map(d => (
                  <Card key={d.id} p={16} style={{ border: `1px solid ${C.amber}20` }}>
                    <div style={{ fontSize: 14, marginBottom: 6 }}>{"⭐".repeat(d.nota)}</div>
                    <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.6, fontStyle: "italic" }}>"{d.texto}"</div>
                    <div style={{ fontSize: 12, fontWeight: 700, marginTop: 8 }}>— {d.nome || "Paciente"}</div>
                    <Btn v="ghost" sz="sm" full style={{ marginTop: 10, justifyContent: "center" }} onClick={() => copiar(`"${d.texto}" — ${d.nome || "Paciente"} ${"⭐".repeat(d.nota)}${assinatura}`, "dep" + d.id)}>{copiado === "dep" + d.id ? "✓ Copiado" : "📋 Usar no post"}</Btn>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* PERSONALIZAR */}
      {aba === "config" && (
        <Card hover={false} p={22} style={{ maxWidth: 520 }}>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 6 }}>⚙ Personalização da Clínica</div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>Estes dados são inseridos automaticamente em todos os materiais (assinatura), sem perder a identidade FisioPiede.</div>
          <label>Nome da clínica</label>
          <input value={cfg.nome} onChange={e => setCfg({ ...cfg, nome: e.target.value })} />
          <label style={{ marginTop: 10, display: "block" }}>WhatsApp</label>
          <input value={cfg.whatsapp} onChange={e => setCfg({ ...cfg, whatsapp: e.target.value })} placeholder="(11) 99999-9999" />
          <label style={{ marginTop: 10, display: "block" }}>Endereço</label>
          <input value={cfg.endereco} onChange={e => setCfg({ ...cfg, endereco: e.target.value })} placeholder="Rua, número, cidade" />
          <label style={{ marginTop: 10, display: "block" }}>Profissional responsável</label>
          <input value={cfg.profissional} onChange={e => setCfg({ ...cfg, profissional: e.target.value })} placeholder="Dr(a). Nome" />
          <Btn v="primary" full style={{ marginTop: 16 }} onClick={() => { salvarCfg(cfg); setCopiado("cfg"); setTimeout(() => setCopiado(""), 2000); }}>{copiado === "cfg" ? "✓ Salvo!" : "Salvar personalização"}</Btn>
          <div style={{ marginTop: 16, padding: 12, background: C.bgGlass, borderRadius: 9, border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Prévia da assinatura</div>
            <div style={{ fontSize: 12, color: C.sub, whiteSpace: "pre-wrap" }}>{assinatura.trim()}</div>
          </div>
        </Card>
      )}
    </div>
  );
}


const PLANOS_INFO = [
  { nome:"Básico", cor:"#64748B", icon:"🟢", preco:0, precoLabel:"Grátis", iaUsos:0, recursos:["Dashboard","Pedidos","Avaliação","Pacientes"] },
  { nome:"Premium", cor:"#8B5CF6", icon:"💎", preco:89.90, precoLabel:"R$ 89,90/mês", iaUsos:30, recursos:["Tudo do Básico","Agenda","Financeiro","Portal do Paciente","30 análises de IA/mês"] },
  { nome:"Enterprise", cor:"#F59E0B", icon:"👑", preco:2998, precoLabel:"R$ 2.998,00", precoParcela:"ou 12x de R$ 249,90", iaUsos:100, recursos:["Tudo do Premium","IA Clínica completa","Academy","Marketing Hub","100 análises de IA/mês"] },
];
// Limite de usos de IA por mês conforme plano (trial = 10)
const IA_LIMITE = { "Básico":0, "Premium":30, "Enterprise":100, "Trial":10 };

function UpgradePlano({ plano, modulo, clinicaNome, clinicaId, email }) {
  const nomesModulo = { agenda:"Agenda", financeiro:"Financeiro", ia:"Inteligência Artificial", academy:"FisioPiede Academy", marketing:"Marketing Hub" };
  const WHATSAPP_FP = "5519920092864"; // WhatsApp da FisioPiede
  const [carregando, setCarregando] = useState("");
  const [erroPag, setErroPag] = useState("");
  // Pagamento automático com cartão (Stripe Checkout)
  const assinarCartao = async (p) => {
    setErroPag("");
    setCarregando(p.nome);
    try {
      const r = await fetch("/api/stripe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plano: p.nome,
          clinicaId: clinicaId || "",
          clinicaNome: clinicaNome || "",
          email: email || "",
          origem: (typeof window !== "undefined" && window.location ? window.location.origin : ""),
        }),
      });
      const dados = await r.json();
      if (dados && dados.url) {
        window.location.href = dados.url; // leva o cliente para a página de pagamento da Stripe
      } else {
        setErroPag((dados && dados.error && dados.error.message) ? dados.error.message : "Não foi possível iniciar o pagamento. Tente novamente.");
        setCarregando("");
      }
    } catch (e) {
      setErroPag("Erro de conexão ao iniciar o pagamento. Tente novamente.");
      setCarregando("");
    }
  };
  // Alternativa manual: PIX/WhatsApp
  const assinarWhatsApp = (p) => {
    const msg = `Olá! Sou da clínica ${clinicaNome||""} e quero assinar o plano ${p.nome} (${p.precoLabel}) da FisioPiede via PIX.`;
    window.open(`https://wa.me/${WHATSAPP_FP}?text=${encodeURIComponent(msg)}`, "_blank");
  };
  return (
    <div style={{ padding: 20 }}>
      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        <Card hover={false} p={32} style={{ textAlign: "center", background: `linear-gradient(135deg,${C.purple}10,${C.accent}06)`, border: `1px solid ${C.purple}25`, marginBottom: 20 }}>
          <div style={{ fontSize: 46, marginBottom: 12 }}>{modulo ? "🔒" : "💎"}</div>
          <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 8 }}>{modulo ? `Módulo ${nomesModulo[modulo] || modulo} indisponível no seu plano` : "Conheça os planos FisioPiede"}</div>
          <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.7, maxWidth: 460, margin: "0 auto" }}>Seu plano atual é o <strong style={{ color: C.text }}>{plano}</strong>. {modulo ? "Faça upgrade para desbloquear este e outros recursos e potencializar sua clínica." : "Escolha o plano ideal para a sua clínica e desbloqueie mais recursos."}</div>
        </Card>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, alignItems: "start" }}>
          {PLANOS_INFO.map(p => { const atual = p.nome === plano; const top = p.nome === "Enterprise"; return (
            <Card key={p.nome} p={0} style={{ border: atual ? `2px solid ${p.cor}` : top ? `1.5px solid ${p.cor}55` : `1px solid ${C.border}`, position: "relative", overflow: "hidden", transform: top ? "scale(1.03)" : "none", boxShadow: top ? `0 10px 40px ${p.cor}22` : "none" }}>
              {/* faixa de cor no topo */}
              <div style={{ height: 4, background: `linear-gradient(90deg,${p.cor},${p.cor}55)` }} />
              {top && !atual && <div style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", fontSize: 9, fontWeight: 800, color: "#fff", background: p.cor, padding: "3px 14px", borderRadius: "0 0 8px 8px", letterSpacing: ".05em" }}>⭐ MAIS COMPLETO</div>}
              {atual && <div style={{ position: "absolute", top: 12, right: 10, fontSize: 9, fontWeight: 800, color: p.cor, background: `${p.cor}18`, padding: "3px 8px", borderRadius: 99 }}>SEU PLANO</div>}
              {/* brilho no canto */}
              <div style={{ position: "absolute", top: 10, right: -20, width: 90, height: 90, borderRadius: "50%", background: `radial-gradient(circle,${p.cor}14,transparent 70%)`, pointerEvents: "none" }} />
              <div style={{ padding: 22 }}>
                <div style={{ fontSize: 32, marginBottom: 8, marginTop: top ? 8 : 0 }}>{p.icon}</div>
                <div style={{ fontSize: 17, fontWeight: 900, color: p.cor }}>{p.nome}</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: C.text, margin: "8px 0 4px", letterSpacing: "-.5px" }}>{p.precoLabel}</div>
                {p.precoParcela && <div style={{ fontSize: 12, fontWeight: 700, color: p.cor, marginBottom: 4 }}>{p.precoParcela}</div>}
                <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                  {p.recursos.map((r, i) => <div key={i} style={{ fontSize: 12, color: C.sub, display: "flex", gap: 7, alignItems: "flex-start" }}><span style={{ color: p.cor, fontWeight: 800, flexShrink: 0 }}>✓</span>{r}</div>)}
                </div>
                {!atual && p.preco > 0 && <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                  <Btn v="primary" full disabled={carregando===p.nome} onClick={() => assinarCartao(p)} style={top ? { background: p.cor } : {}}>{carregando===p.nome ? "Abrindo pagamento..." : "💳 Assinar com cartão"}</Btn>
                  <button onClick={() => assinarWhatsApp(p)} style={{ background: "none", border: "none", color: C.muted, fontSize: 11, cursor: "pointer", textDecoration: "underline" }}>ou pagar via PIX/WhatsApp</button>
                </div>}
                {atual && p.preco > 0 && <div style={{ marginTop: 16 }}>
                  <Btn v="ghost" sz="sm" full onClick={() => gerarReciboPDF({clinica:clinicaNome, descricao:`Assinatura ${p.nome}`, valor:p.preco, forma:"Cartão / PIX"})}>🧾 Gerar recibo da assinatura</Btn>
                </div>}
              </div>
            </Card>
          ); })}
        </div>
        {erroPag && <div style={{ textAlign: "center", marginTop: 16, padding: "10px 14px", background: "#F9731614", border: "1px solid #F9731640", borderRadius: 10, color: "#F97316", fontSize: 12 }}>{erroPag}</div>}
        <div style={{ textAlign: "center", marginTop: 20 }}>
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>No pagamento com cartão, a assinatura é renovada automaticamente todo mês e o plano é liberado após a confirmação. Você também pode pagar via PIX/WhatsApp, com ativação manual pela nossa equipe.</div>
        </div>
      </div>
    </div>
  );
}

function SemAcessoColaborador() {
  return (
    <div style={{ padding: 20 }}>
      <div style={{ maxWidth: 480, margin: "40px auto 0", textAlign: "center" }}>
        <Card hover={false} p={36}>
          <div style={{ fontSize: 46, marginBottom: 14 }}>🔒</div>
          <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 8 }}>Acesso restrito</div>
          <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.7 }}>Esta área é exclusiva da administração da clínica. Seu perfil de colaborador não tem acesso ao Financeiro e aos valores.</div>
        </Card>
      </div>
    </div>
  );
}

function ColaboradoresManager({ clinicaId }) {
  const [colabs, setColabs] = useState(() => (LS.read("fp:colaboradores") || []).filter(c => c.clinicaId === clinicaId));
  const [form, setForm] = useState({ nome: "", usuario: "", senha: "" });
  const [msg, setMsg] = useState("");
  useEffect(() => { (async () => { const all = await LS.readAsync("fp:colaboradores"); if (all) setColabs(all.filter(c => c.clinicaId === clinicaId)); })(); }, [clinicaId]);

  const salvarTodos = (lista) => {
    const outros = (LS.read("fp:colaboradores") || []).filter(c => c.clinicaId !== clinicaId);
    LS.write("fp:colaboradores", [...outros, ...lista]);
  };
  const add = async () => {
    if (!form.nome.trim() || !form.usuario.trim() || !form.senha.trim()) { setMsg("Preencha nome, usuário e senha."); return; }
    const todos = LS.read("fp:colaboradores") || [];
    if (todos.some(c => c.usuario === form.usuario.trim())) { setMsg("Esse usuário já existe. Escolha outro."); return; }
    const cred = await SENHA_FP.criar(form.senha.trim()); // 🔐 só a impressão digital é gravada
    const novo = { id: Date.now(), nome: form.nome.trim(), usuario: form.usuario.trim(), ...cred, clinicaId };
    const lista = [...colabs, novo];
    setColabs(lista); salvarTodos(lista);
    setForm({ nome: "", usuario: "", senha: "" }); setMsg("");
  };
  const remover = (id) => { const lista = colabs.filter(c => c.id !== id); setColabs(lista); salvarTodos(lista); };

  return (
    <Card hover={false} p={20} style={{ marginBottom: 16, border: `1px solid ${C.green}25` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 20 }}>👥</span>
        <span style={{ fontWeight: 800, fontSize: 15 }}>Colaboradores da Clínica</span>
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 16, lineHeight: 1.6 }}>Crie logins para sua equipe. Colaboradores acessam pacientes, pedidos, avaliação e agenda — mas <strong style={{color:C.sub}}>não veem o Financeiro nem os valores</strong>.</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 8, alignItems: "end", marginBottom: 14 }}>
        <div><label>Nome</label><input value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} placeholder="Nome do colaborador" /></div>
        <div><label>Usuário (login)</label><input value={form.usuario} onChange={e => setForm({ ...form, usuario: e.target.value })} placeholder="ex: maria.recepcao" /></div>
        <div><label>Senha</label><input value={form.senha} onChange={e => setForm({ ...form, senha: e.target.value })} placeholder="Senha de acesso" /></div>
        <Btn v="primary" onClick={add}>+ Adicionar</Btn>
      </div>
      {msg && <div style={{ fontSize: 11, color: C.red, marginBottom: 10 }}>{msg}</div>}

      {colabs.length === 0 ? (
        <div style={{ fontSize: 12, color: C.muted, textAlign: "center", padding: "14px 0", background: C.bgGlass, borderRadius: 9 }}>Nenhum colaborador cadastrado ainda.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {colabs.map(c => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 13px", background: C.bgGlass, borderRadius: 9, border: `1px solid ${C.border}` }}>
              <div style={{ width: 34, height: 34, borderRadius: "50%", background: `${C.green}18`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: C.green }}>{c.nome.charAt(0).toUpperCase()}</div>
              <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 700 }}>{c.nome}</div><div style={{ fontSize: 11, color: C.muted }}>👤 {c.usuario}</div></div>
              <Badge label="Sem financeiro" color={C.amber} />
              <Btn v="ghost" sz="sm" onClick={() => remover(c.id)}>Remover</Btn>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// FINANCEIRO ENTERPRISE — DRE / Business Intelligence da Clínica
// ══════════════════════════════════════════════════════════════════════════════
function FinanceiroClinica({ clinicaId, clinicaObj, meusPedidos, pacientes }) {
  const peds = Array.isArray(meusPedidos) ? meusPedidos : [];
  const finKey = "fp:fin:" + clinicaId;
  const metaKey = "fp:meta:" + clinicaId;
  const [fin, setFin] = useState(() => LS.read(finKey) || {});   // { pedidoId: {venda, produto, frete, taxa, comissao, marketing, outras} }
  const [meta, setMeta] = useState(() => LS.read(metaKey) || 30000);
  const [aba, setAba] = useState("dashboard");
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ venda: "", produto: "Palmilha", frete: "", taxa: "", comissao: "", marketing: "", outras: "" });

  useEffect(() => { (async () => { const f = await LS.readAsync(finKey); if (f) setFin(f); const m = await LS.readAsync(metaKey); if (m) setMeta(m); })(); }, [clinicaId]);

  const salvarFin = (n) => { setFin(n); LS.write(finKey, n); };
  const salvarMeta = (v) => { setMeta(v); LS.write(metaKey, v); };

  // Dados de cada pedido (com lançamentos financeiros)
  const dados = peds.map(p => {
    const f = fin[p.id] || {};
    const produto = f.produto || p.produto || "Palmilha";
    const custo = CUSTO_PRODUTO[produto] || PRECO;
    const venda = Number(f.venda) || 0;
    const despesas = (Number(f.frete) || 0) + (Number(f.taxa) || 0) + (Number(f.comissao) || 0) + (Number(f.marketing) || 0) + (Number(f.outras) || 0);
    const lucroBruto = venda - custo;
    const lucroLiquido = venda - custo - despesas;
    return { ...p, produto, custo, venda, despesas, lucroBruto, lucroLiquido, lancado: venda > 0 };
  });

  const lancados = dados.filter(d => d.lancado);
  const fatTotal = lancados.reduce((a, d) => a + d.venda, 0);
  const custoTotal = lancados.reduce((a, d) => a + d.custo, 0);
  const despTotal = lancados.reduce((a, d) => a + d.despesas, 0);
  const lucroLiq = lancados.reduce((a, d) => a + d.lucroLiquido, 0);
  const lucroBruto = lancados.reduce((a, d) => a + d.lucroBruto, 0);
  const ticket = lancados.length ? fatTotal / lancados.length : 0;
  const margem = fatTotal ? (lucroLiq / fatTotal) * 100 : 0;
  const roi = (custoTotal + despTotal) ? (lucroLiq / (custoTotal + despTotal)) * 100 : 0;

  // Períodos
  const hoje = new Date().toISOString().split("T")[0];
  const mesAtual = new Date().toISOString().slice(0, 7);
  const anoAtual = String(new Date().getFullYear());
  const noPeriodo = (d, per) => (d.data || "").startsWith(per);
  const somaPer = (per) => { const ds = lancados.filter(d => noPeriodo(d, per)); return { fat: ds.reduce((a, d) => a + d.venda, 0), lucro: ds.reduce((a, d) => a + d.lucroLiquido, 0), n: ds.length }; };
  const dia = somaPer(hoje), mes = somaPer(mesAtual), ano = somaPer(anoAtual);

  // Conversão avaliações → vendas
  const totalPac = (pacientes || []).length;
  const conversao = totalPac ? Math.round((lancados.length / totalPac) * 100) : 0;

  // Projeção (baseada no ritmo do mês)
  const diaDoMes = new Date().getDate();
  const projFat = diaDoMes ? Math.round((mes.fat / diaDoMes) * 30) : 0;
  const projLucro = diaDoMes ? Math.round((mes.lucro / diaDoMes) * 30) : 0;
  const pctMeta = meta ? Math.min(100, Math.round((mes.fat / meta) * 100)) : 0;

  // Faturamento mensal (12 meses do ano atual)
  const mesesLabels = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const fatMensal = mesesLabels.map((_, i) => { const per = `${anoAtual}-${String(i + 1).padStart(2, "0")}`; return lancados.filter(d => noPeriodo(d, per)).reduce((a, d) => a + d.venda, 0); });
  const lucroMensal = mesesLabels.map((_, i) => { const per = `${anoAtual}-${String(i + 1).padStart(2, "0")}`; return lancados.filter(d => noPeriodo(d, per)).reduce((a, d) => a + d.lucroLiquido, 0); });

  // Produtos e patologias
  const porProduto = {}; lancados.forEach(d => { porProduto[d.produto] = (porProduto[d.produto] || 0) + 1; });
  const porPatologia = {}; lancados.forEach(d => { const pac = (pacientes || []).find(x => x.id === d.pacienteId); const pat = (pac && pac.patologia) || d.patologia || "Outros"; porPatologia[pat] = (porPatologia[pat] || 0) + 1; });

  // Ranking de pacientes por rentabilidade
  const porPaciente = {};
  lancados.forEach(d => { const pac = (pacientes || []).find(x => x.id === d.pacienteId); const nome = (pac && `${pac.nome} ${pac.sobrenome || ""}`.trim()) || d.paciente || "Paciente"; if (!porPaciente[nome]) porPaciente[nome] = { lucro: 0, vendas: 0 }; porPaciente[nome].lucro += d.lucroLiquido; porPaciente[nome].vendas += 1; });
  const rankPac = Object.entries(porPaciente).map(([nome, v]) => ({ nome, ...v })).sort((a, b) => b.lucro - a.lucro).slice(0, 8);

  const abrirLanc = (d) => { const f = fin[d.id] || {}; setForm({ venda: f.venda || "", produto: f.produto || d.produto || "Palmilha", frete: f.frete || "", taxa: f.taxa || "", comissao: f.comissao || "", marketing: f.marketing || "", outras: f.outras || "" }); setEditId(d.id); };
  const salvarLanc = () => { const n = { ...fin, [editId]: { ...form } }; salvarFin(n); setEditId(null); };

  const KPI = ({ label, valor, cor, prefix = "R$ ", sufix = "" }) => (
    <Card p={16}><div style={{ fontSize: 10, color: C.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: ".05em" }}>{label}</div><div style={{ fontSize: 19, fontWeight: 900, color: cor }}>{prefix}{typeof valor === "number" ? brl(valor) : valor}{sufix}</div></Card>
  );

  const Pizza = ({ dados: dd, titulo }) => {
    const total = Object.values(dd).reduce((a, b) => a + b, 0) || 1;
    const cores = [C.accent, C.purple, C.green, C.amber, C.red, "#EC4899", "#14B8A6"];
    let acc = 0;
    const segs = Object.entries(dd).map(([k, v], i) => { const ini = acc / total * 360; acc += v; const fim = acc / total * 360; return { k, v, cor: cores[i % cores.length], ini, fim, pct: Math.round(v / total * 100) }; });
    const grad = segs.map(s => `${s.cor} ${s.ini}deg ${s.fim}deg`).join(", ");
    return (
      <Card p={18}><div style={{ fontWeight: 800, fontSize: 13, marginBottom: 14 }}>{titulo}</div>
        {segs.length === 0 ? <div style={{ fontSize: 12, color: C.muted, textAlign: "center", padding: 20 }}>Sem dados ainda</div> : (
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div style={{ width: 110, height: 110, borderRadius: "50%", background: `conic-gradient(${grad})`, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>{segs.map((s, i) => (<div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}><span style={{ width: 11, height: 11, borderRadius: 3, background: s.cor }} /><span style={{ fontSize: 12, flex: 1 }}>{s.k}</span><span style={{ fontSize: 12, fontWeight: 800 }}>{s.v}</span><span style={{ fontSize: 10, color: C.muted }}>{s.pct}%</span></div>))}</div>
          </div>
        )}
      </Card>
    );
  };

  const ABAS = [{ id: "dashboard", icon: "📊", label: "Dashboard" }, { id: "lancamentos", icon: "📝", label: "Lançamentos" }, { id: "graficos", icon: "📈", label: "Gráficos" }, { id: "fechamento", icon: "🧾", label: "Fechamento FisioPiede" }];

  return (
    <div style={{ padding: 20 }}>
      <SH title="Financeiro — Gestão da Clínica" sub="DRE, lucratividade e indicadores em tempo real" />
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, marginBottom: 20, overflowX: "auto" }}>
        {ABAS.map(a => { const at = aba === a.id; return (<button key={a.id} onClick={() => setAba(a.id)} style={{ padding: "10px 16px", fontSize: 13, fontWeight: at ? 700 : 500, color: at ? C.green : C.muted, background: "none", borderBottom: at ? `2px solid ${C.green}` : "2px solid transparent", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}><span>{a.icon}</span>{a.label}</button>); })}
      </div>

      {aba === "dashboard" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Períodos */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
            {[["Hoje", dia, C.accent], ["Este mês", mes, C.green], ["Este ano", ano, C.purple]].map(([t, d, cor], i) => (
              <Card key={i} p={18} style={{ border: `1px solid ${cor}25`, background: `linear-gradient(135deg,${cor}08,transparent)` }}>
                <div style={{ fontSize: 11, color: cor, fontWeight: 700, textTransform: "uppercase", marginBottom: 10 }}>{t}</div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}><span style={{ fontSize: 11, color: C.muted }}>Faturamento</span><span style={{ fontSize: 14, fontWeight: 900 }}>R$ {brl(d.fat)}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}><span style={{ fontSize: 11, color: C.muted }}>Lucro líquido</span><span style={{ fontSize: 14, fontWeight: 900, color: C.green }}>R$ {brl(d.lucro)}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 11, color: C.muted }}>Vendas</span><span style={{ fontSize: 14, fontWeight: 900 }}>{d.n}</span></div>
              </Card>
            ))}
          </div>

          {/* Indicadores executivos */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 11 }}>
            <KPI label="Faturamento total" valor={fatTotal} cor={C.accent} />
            <KPI label="Lucro líquido" valor={lucroLiq} cor={C.green} />
            <KPI label="Ticket médio" valor={ticket} cor={C.purple} />
            <KPI label="Margem de lucro" valor={Math.round(margem)} cor={C.amber} prefix="" sufix="%" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 11 }}>
            <KPI label="Custo FisioPiede" valor={custoTotal} cor={C.muted} />
            <KPI label="Despesas" valor={despTotal} cor={C.red} />
            <KPI label="ROI" valor={Math.round(roi)} cor={C.green} prefix="" sufix="%" />
            <KPI label="Conversão (pac.→venda)" valor={conversao} cor={C.accent} prefix="" sufix="%" />
          </div>

          {/* Meta mensal */}
          <Card hover={false} p={20}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
              <div style={{ fontWeight: 800, fontSize: 14 }}>🎯 Meta mensal</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 11, color: C.muted }}>Meta R$</span><input type="number" value={meta} onChange={e => salvarMeta(Number(e.target.value))} style={{ width: 120 }} /></div>
            </div>
            <div style={{ height: 14, background: C.border, borderRadius: 99, overflow: "hidden", marginBottom: 8 }}><div style={{ height: "100%", width: `${pctMeta}%`, background: `linear-gradient(90deg,${C.green},${C.accent})`, borderRadius: 99, transition: "width .6s" }} /></div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}><span style={{ color: C.green, fontWeight: 700 }}>R$ {brl(mes.fat)} ({pctMeta}%)</span><span style={{ color: C.muted }}>Faltam R$ {brl(Math.max(0, meta - mes.fat))}</span></div>
          </Card>

          {/* Projeção */}
          <Card hover={false} p={20} style={{ background: `linear-gradient(135deg,${C.purple}08,transparent)`, border: `1px solid ${C.purple}20` }}>
            <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 4 }}>📊 Projeção do mês (no ritmo atual)</div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 14 }}>Estimativa baseada no desempenho até hoje</div>
            <div style={{ display: "flex", gap: 36, flexWrap: "wrap" }}>
              <div><div style={{ fontSize: 10, color: C.muted }}>Faturamento previsto</div><div style={{ fontSize: 24, fontWeight: 900, color: C.accent }}>R$ {brl(projFat)}</div></div>
              <div><div style={{ fontSize: 10, color: C.muted }}>Lucro previsto</div><div style={{ fontSize: 24, fontWeight: 900, color: C.green }}>R$ {brl(projLucro)}</div></div>
            </div>
          </Card>

          {/* Ranking pacientes */}
          {rankPac.length > 0 && (
            <Card hover={false} p={20}>
              <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 14 }}>🏆 Pacientes mais rentáveis</div>
              {rankPac.map((r, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                  <span style={{ width: 22, fontSize: 11, fontWeight: 800, color: C.muted }}>#{i + 1}</span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{r.nome}</span>
                  <span style={{ fontSize: 11, color: C.muted }}>{r.vendas} venda(s)</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: C.green }}>R$ {brl(r.lucro)}</span>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}

      {aba === "lancamentos" && (
        <Card hover={false} p={0} style={{ overflow: "hidden" }}>
          <div style={{ padding: "13px 16px", borderBottom: `1px solid ${C.border}` }}><div style={{ fontWeight: 800 }}>Lançamentos por Pedido</div><div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Informe o valor cobrado do paciente e as despesas de cada pedido para calcular seu lucro real.</div></div>
          {dados.length === 0 ? <div style={{ padding: 30, textAlign: "center", color: C.muted, fontSize: 13 }}>Nenhum pedido ainda.</div> : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ borderBottom: `1px solid ${C.border}` }}>{["Pedido", "Paciente", "Produto", "Venda", "Custo", "Despesas", "Lucro líq.", ""].map(h => <th key={h} style={{ padding: "10px 14px", textAlign: "left", color: C.muted, fontWeight: 700, fontSize: 9, textTransform: "uppercase" }}>{h}</th>)}</tr></thead>
              <tbody>
                {dados.map((d, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "10px 14px", fontWeight: 700 }}>{d.id}</td>
                    <td style={{ padding: "10px 14px" }}>{d.paciente || "—"}</td>
                    <td style={{ padding: "10px 14px" }}>{d.produto}</td>
                    <td style={{ padding: "10px 14px", fontWeight: 700 }}>{d.venda ? "R$ " + brl(d.venda) : <span style={{ color: C.amber }}>a lançar</span>}</td>
                    <td style={{ padding: "10px 14px", color: C.muted }}>R$ {brl(d.custo)}</td>
                    <td style={{ padding: "10px 14px", color: C.red }}>R$ {brl(d.despesas)}</td>
                    <td style={{ padding: "10px 14px", fontWeight: 800, color: d.lucroLiquido >= 0 ? C.green : C.red }}>{d.lancado ? "R$ " + brl(d.lucroLiquido) : "—"}</td>
                    <td style={{ padding: "10px 14px" }}><Btn v="outline" sz="sm" onClick={() => abrirLanc(d)}>{d.lancado ? "Editar" : "Lançar"}</Btn></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {aba === "graficos" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Card hover={false} p={18}><div style={{ fontWeight: 800, fontSize: 13, marginBottom: 14 }}>Faturamento Mensal — {anoAtual}</div><Bars data={fatMensal} color={C.green} labels={mesesLabels} h={120} /></Card>
          <Card hover={false} p={18}><div style={{ fontWeight: 800, fontSize: 13, marginBottom: 14 }}>Evolução do Lucro — {anoAtual}</div><Bars data={lucroMensal} color={C.accent} labels={mesesLabels} h={120} /></Card>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Pizza dados={porPatologia} titulo="Patologias mais atendidas" />
            <Pizza dados={porProduto} titulo="Produtos mais vendidos" />
          </div>
        </div>
      )}

      {aba === "fechamento" && (
        <FechamentoFisioPiede dados={dados} clinicaNome={clinicaObj?.nome || "Clínica"} />
      )}

      {/* Modal de lançamento */}
      {editId && (
        <Modal onClose={() => setEditId(null)}>
          <Card hover={false} p={0} style={{ width: "100%", maxWidth: 440, animation: "fadeUp .25s ease" }}>
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}` }}><div style={{ fontWeight: 800, fontSize: 15 }}>Lançamento financeiro — {editId}</div></div>
            <div style={{ padding: 20 }}>
              <label>Produto</label>
              <select value={form.produto} onChange={e => setForm({ ...form, produto: e.target.value })}>{PRODUTOS_FP.map(p => <option key={p}>{p}</option>)}</select>
              <div style={{ fontSize: 10, color: C.muted, margin: "4px 0 12px" }}>Custo FisioPiede: R$ {brl(CUSTO_PRODUTO[form.produto] || PRECO)}</div>
              <label>Valor cobrado do paciente (venda)</label>
              <input type="number" value={form.venda} onChange={e => setForm({ ...form, venda: e.target.value })} placeholder="Ex: 850" />
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: "uppercase", margin: "14px 0 8px" }}>Despesas (opcional)</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[["frete", "Frete"], ["taxa", "Taxa cartão"], ["comissao", "Comissão"], ["marketing", "Marketing"], ["outras", "Outras"]].map(([k, l]) => (
                  <div key={k}><label style={{ fontSize: 10 }}>{l}</label><input type="number" value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} placeholder="0" /></div>
                ))}
              </div>
              {form.venda > 0 && (
                <div style={{ marginTop: 14, padding: 12, background: C.bgGlass, borderRadius: 9, fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ color: C.muted }}>Lucro bruto</span><span style={{ fontWeight: 700 }}>R$ {brl(Number(form.venda) - (CUSTO_PRODUTO[form.produto] || PRECO))}</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: C.muted }}>Lucro líquido</span><span style={{ fontWeight: 800, color: C.green }}>R$ {brl(Number(form.venda) - (CUSTO_PRODUTO[form.produto] || PRECO) - (Number(form.frete) || 0) - (Number(form.taxa) || 0) - (Number(form.comissao) || 0) - (Number(form.marketing) || 0) - (Number(form.outras) || 0))}</span></div>
                </div>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 16 }}><Btn v="ghost" full onClick={() => setEditId(null)}>Cancelar</Btn><Btn v="primary" full onClick={salvarLanc}>Salvar</Btn></div>
            </div>
          </Card>
        </Modal>
      )}
    </div>
  );
}

// Fechamento de cobrança FisioPiede (o que a clínica deve pagar)
function FechamentoFisioPiede({ dados, clinicaNome }) {
  const porProd = {};
  dados.forEach(d => { const pr = d.produto || "Palmilha"; if (!porProd[pr]) porProd[pr] = { n: 0, custo: CUSTO_PRODUTO[pr] || PRECO }; porProd[pr].n += 1; });
  const totalDevido = Object.values(porProd).reduce((a, p) => a + p.n * p.custo, 0);

  const exportar = () => {
    let linhas = [["Produto", "Quantidade", "Custo unit.", "Total"]];
    Object.entries(porProd).forEach(([pr, v]) => linhas.push([pr, v.n, v.custo.toFixed(2), (v.n * v.custo).toFixed(2)]));
    linhas.push(["", "", "TOTAL", totalDevido.toFixed(2)]);
    const csv = "\ufeff" + linhas.map(l => l.join(";")).join("\n");
    try { const b = new Blob([csv], { type: "text/csv;charset=utf-8;" }); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = "fechamento-fisiopiede.csv"; a.click(); } catch (e) { }
  };

  return (
    <Card hover={false} p={22}>
      <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>🧾 Fechamento FisioPiede — {clinicaNome}</div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 18 }}>Valor que a clínica deve pagar à FisioPiede neste período (custo dos produtos).</div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 16 }}>
        <thead><tr style={{ borderBottom: `1px solid ${C.border}` }}>{["Produto", "Qtd", "Custo unit.", "Total"].map(h => <th key={h} style={{ padding: "9px 12px", textAlign: "left", color: C.muted, fontSize: 9, textTransform: "uppercase" }}>{h}</th>)}</tr></thead>
        <tbody>
          {Object.entries(porProd).map(([pr, v], i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
              <td style={{ padding: "10px 12px", fontWeight: 700 }}>{pr}</td>
              <td style={{ padding: "10px 12px" }}>{v.n}</td>
              <td style={{ padding: "10px 12px", color: C.muted }}>R$ {brl(v.custo)}</td>
              <td style={{ padding: "10px 12px", fontWeight: 800 }}>R$ {brl(v.n * v.custo)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", background: `${C.amber}10`, border: `1px solid ${C.amber}28`, borderRadius: 10 }}>
        <span style={{ fontWeight: 700 }}>Total devido à FisioPiede</span>
        <span style={{ fontSize: 22, fontWeight: 900, color: C.amber }}>R$ {brl(totalDevido)}</span>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}><Btn v="outline" onClick={exportar}>📊 Exportar Excel</Btn><Btn v="primary" onClick={() => window.print && window.print()}>📄 PDF</Btn></div>
    </Card>
  );
}

function Placeholder({title,icon}) {
  return (
    <div style={{padding:20,display:"flex",alignItems:"center",justifyContent:"center",minHeight:400}}>
      <div style={{textAlign:"center"}}><div style={{fontSize:56,marginBottom:12}}>{icon}</div><div style={{fontSize:16,fontWeight:800,marginBottom:6}}>{title}</div><div style={{fontSize:12,color:C.muted}}>Módulo em desenvolvimento</div></div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// APP ROOT
// ══════════════════════════════════════════════════════════════════════════════
function AppCore() {
  const [screen,setScreen]       = useState("splash");
  const [userType,setUserType]   = useState(null);
  const [userName,setUserName]   = useState("");
  const [userEmail,setEmail]     = useState("");
  const [page,setPage]           = useState("dashboard");
  const isMobile = useIsMobile(760);
  const [drawerOpen,setDrawerOpen] = useState(false);
  const [sincronizando,setSincronizando] = useState(true);
  useEffect(()=>{ setDrawerOpen(false); },[page]);
  const [clinicaId,setClinicaId] = useState(null);
  const [pacienteId,setPacienteId] = useState(null);

  // Dados iniciais: localStorage síncrono (produção) ou seed. window.storage hidrata depois via useEffect.
  const [clinicas,   _setClinicas]   = useState(() => LS.read("fp:clinicas")  || []);
  const [pedidos,    _setPedidos]    = useState(() => LS.read("fp:pedidos")   || []);
  const [pacientes,  _setPacientes]  = useState(() => LS.read("fp:pacientes") || []);
  const [consultas,  _setConsultas]  = useState(() => LS.read("fp:consultas") || []);

  // Trava de segurança: só grava no banco DEPOIS de carregar os dados atualizados.
  // Antes disso, grava só no cache local (evita que cópia velha apague dados novos).
  const hidratadoRef = useRef(false);
  // ── PROTEÇÃO MULTI-SESSÃO ──────────────────────────────────────────────────
  // Ao gravar pedidos, junta com o que já está na nuvem (merge por id) em vez de
  // sobrescrever. Assim, dois usuários ao mesmo tempo não apagam o trabalho um do
  // outro. Exclusões ficam registradas numa lista (tombstones) para não "voltarem".
  const pedidosDelRef = useRef(LS.read("fp:pedidos:del") || []);
  const pedidosRef = useRef([]);
  const saveTimerRef = useRef(null);
  // Salva pedidos de forma confiável: agrupa gravações próximas (debounce) e, ao
  // gravar, junta com a versão atual da nuvem por id (não sobrescreve outras sessões).
  // NÃO altera o estado da tela aqui — isso evita que o pedido recém-criado "suma".
  const persistirPedidos = (lista) => {
    pedidosRef.current = lista;
    LS.write("fp:pedidos", lista, true); // cache local imediato (não perde nada na tela)
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const atual = pedidosRef.current || [];
      try {
        const nuvem = (await LS.readAsync("fp:pedidos")) || [];
        const del = pedidosDelRef.current || [];
        const mapa = {};
        nuvem.forEach(p => { if (p && p.id != null) mapa[p.id] = p; });
        atual.forEach(p => { if (p && p.id != null) mapa[p.id] = p; }); // edição local prevalece
        del.forEach(id => { delete mapa[id]; });
        LS.writePedidos(Object.values(mapa));
      } catch (e) { LS.writePedidos(atual); }
    }, 350);
  };
  const excluirPedido = (id) => {
    const del = [...(pedidosDelRef.current || []), id];
    pedidosDelRef.current = del;
    LS.write("fp:pedidos:del", del);
    _setPedidos(prev => { const n = prev.filter(x => x.id !== id); persistirPedidos(n); return n; });
  };
  const setClinicas  = (u) => _setClinicas(p  => { const n = typeof u==='function'?u(p):u; LS.write("fp:clinicas",  n, !hidratadoRef.current); return n; });
  const setPedidos   = (u) => _setPedidos(p   => { const n = typeof u==='function'?u(p):u; persistirPedidos(n); return n; });
  const setPacientes = (u) => _setPacientes(p => { const n = typeof u==='function'?u(p):u; LS.write("fp:pacientes", n, !hidratadoRef.current); return n; });
  const setConsultas = (u) => _setConsultas(p => { const n = typeof u==='function'?u(p):u; LS.write("fp:consultas", n, !hidratadoRef.current); return n; });

  // Junta a lista do banco com a da tela: a base é o banco (versão mais fresca de
  // outras sessões), mas pedidos criados localmente que ainda NÃO estão no banco
  // são preservados (evita que a recarga apague um pedido recém-criado). Remove os
  // que foram excluídos de propósito (tombstones).
  const mergeReload = (nuvem, local) => {
    const del = pedidosDelRef.current || [];
    const mapa = {};
    (nuvem || []).forEach(p => { if (p && p.id != null) mapa[p.id] = p; });
    (local || []).forEach(p => { if (p && p.id != null && !(p.id in mapa)) mapa[p.id] = p; });
    del.forEach(id => { delete mapa[id]; });
    return Object.values(mapa);
  };

  // Recarrega tudo do storage de forma ASSÍNCRONA (window.storage no artifact)
  const recarregarDados = async () => {
    setSincronizando(true);
    try {
      const c = await LS.readAsync("fp:clinicas");   if(c) _setClinicas(c);
      const p = await LS.readPedidosAsync();         if(p) _setPedidos(prev => mergeReload(p, prev));
      const pa= await LS.readAsync("fp:pacientes");  if(pa)_setPacientes(pa);
      const co= await LS.readAsync("fp:consultas");  if(co)_setConsultas(co);
    } catch(e) {
      // se falhar, mantém o que já está na tela (não apaga nada)
    } finally {
      hidratadoRef.current = true; // libera gravações no banco a partir daqui
      setSincronizando(false);
    }
  };

  // HIDRATAÇÃO: ao montar, carrega os dados reais do window.storage (persistência do artifact)
  useEffect(() => { recarregarDados(); }, []);

  // Recarrega pedidos ao abrir a página de pedidos (pega criados em outra sessão),
  // sem apagar pedidos recém-criados que ainda não foram para o banco.
  useEffect(() => {
    if(page !== "pedidos") return;
    (async () => { const p = await LS.readPedidosAsync(); if(p) _setPedidos(prev => mergeReload(p, prev)); })();
  }, [page]);

  // Após pagar o pacote de +50 análises, credita ao voltar (?pagamento=ok) se houver intenção pendente.
  useEffect(() => {
    if(!clinicaId || typeof window==="undefined" || !window.location) return;
    if(!/pagamento=ok/.test(window.location.search)) return;
    const pend = LS.read("fp:compraPendente:" + clinicaId);
    if(pend && pend.tipo === "ia50"){
      addCreditoIA(clinicaId, pend.qtd || 50);
      LS.write("fp:compraPendente:" + clinicaId, null);
      try { window.history.replaceState({}, "", window.location.pathname); } catch(e){}
      setTimeout(()=>alert("✅ "+(pend.qtd||50)+" análises de IA foram adicionadas ao seu plano!"), 400);
    }
  }, [clinicaId]);

  // Recarrega todos os dados do storage ao fazer login (garante dados frescos)
  const login = (type,name,email,_,cid) => {
    recarregarDados();
    setUserType(type); setUserName(name); setEmail(email);
    if(type==="paciente"){
      setPacienteId(cid||null); setClinicaId(null);
      // Gera notificações automáticas para o paciente
      try {
        const pac = pacientes.find(p=>p.id===cid);
        if(pac){
          const destino = "paciente:"+cid;
          const jaNotif = LS.read("fp:notif:"+destino) || [];
          const hoje = new Date().toISOString().split("T")[0];
          const flagKey = "fp:notifday:"+destino;
          if(LS.read(flagKey)!==hoje){
            pushNotif(destino,"💪","Hora dos exercícios!","Não esqueça de fazer seus exercícios de hoje.","exercicios");
            if(pac.dataRetorno){
              const dias = Math.ceil((new Date(pac.dataRetorno)-new Date())/86400000);
              if(dias>=0&&dias<=3) pushNotif(destino,"📅","Consulta de retorno próxima",`Seu retorno é em ${dias===0?"hoje":dias+" dia(s)"} (${pac.dataRetorno.split("-").reverse().join("/")}).`,"agenda");
            }
            LS.write(flagKey,hoje);
          }
        }
      } catch(e){}
    }
    else { setClinicaId(cid||null); setPacienteId(null); }
    setPage("dashboard"); setScreen("app");
  };
  const logout = () => { setScreen("login"); setUserType(null); setPage("dashboard"); };

  // Isolamento por clínica — todas as queries usam clinicaId (número), nunca nome
  const clinicaObj  = clinicaId ? clinicas.find(c=>c.id===clinicaId) : null;
  const clinicaName = clinicaObj?.nome || null;
  const pacienteLogado = pacienteId ? pacientes.find(p=>p.id===pacienteId) : null;

  // Filtros isolados por clínica logada
  const meusPedidos  = clinicaId ? pedidos.filter(p=>p.clinicaId===clinicaId)  : pedidos;
  const meusPacientes= clinicaId ? pacientes.filter(p=>p.clinicaId===clinicaId): pacientes;

  // Controle de acesso por plano da clínica
  const PLANO_MODULOS = {
    "Básico":     ["dashboard","pedidos","avaliacao","pacientes","financeiro","config"],
    "Premium":    ["dashboard","pedidos","avaliacao","pacientes","agenda","mensagens","financeiro","config"],
    "Enterprise": null, // null = acesso total
  };
  // Período de teste DESATIVADO: nenhuma clínica entra ou permanece em teste.
  const TRIAL_DIAS = 2;
  const planoContratado = (clinicaObj && clinicaObj.plano) || "Básico";
  let emTrial = false, diasRestantesTrial = 0;
  // Conta de teste com IA ilimitada (não consome cota), para validações internas.
  const IA_ILIMITADA_EMAILS = ["fisiopiede2@fisiopiede.com.br"];
  // Durante o trial, acesso Enterprise (tudo). Depois, o plano contratado.
  // Mas se a assinatura estiver vencida/suspensa, a clínica perde os recursos premium.
  const assinatura = clinicaObj ? ASSINATURA.calcular(clinicaObj) : null;
  const assinaturaBloqueada = !emTrial && assinatura && assinatura.bloqueada;
  const planoClinica = emTrial ? "Enterprise" : (assinaturaBloqueada ? "Básico" : planoContratado);
  const planoIAbase = emTrial ? "Trial" : planoContratado;
  const planoIAefetivo = (userEmail && IA_ILIMITADA_EMAILS.includes(String(userEmail).toLowerCase().trim())) ? "admin" : planoIAbase;
  const modulosPermitidos = PLANO_MODULOS[planoClinica]; // null = todos

  const ehClinica = userType==="clinica" || userType==="colaborador";
  let nav = userType==="admin" ? NAV_ADMIN : userType==="paciente" ? NAV_PACIENTE : NAV_CLINICA;
  // Em vez de esconder, mostramos TODOS os itens e marcamos os bloqueados com cadeado.
  let modulosBloqueados = [];
  // O cadeado reflete o PLANO CONTRATADO (não o acesso temporário do teste),
  // para a clínica enxergar o que terá quando o teste acabar.
  const modulosDoContratado = assinaturaBloqueada ? PLANO_MODULOS["Básico"] : PLANO_MODULOS[planoContratado];
  if (ehClinica && modulosDoContratado) {
    modulosBloqueados = NAV_CLINICA.filter(item => !modulosDoContratado.includes(item.id)).map(item => item.id);
  }
  // Colaborador: financeiro fica bloqueado (acesso restrito)
  if (userType==="colaborador" && !modulosBloqueados.includes("financeiro")) {
    modulosBloqueados = [...modulosBloqueados, "financeiro"];
  }

  // 🔴 Contadores de pendência no menu (admin): clínicas a aprovar, pedidos novos, msgs sem resposta
  const navBadges = (()=>{
    if(userType!=="admin") return {};
    try{
      const solic = (LS.read("fp:solicitacoes")||[]).length;
      const novos = (pedidos||[]).filter(p=>p.status==="Recebido").length;
      let msgs = 0;
      (pacientes||[]).forEach(p=>{ const ms=LS.read("fp:chat:"+p.id)||[]; const la=Number(LS.read("fp:chatlido:clinica:"+p.id)||0); msgs += ms.filter(m=>m.de==="paciente"&&m.ts>la).length; });
      return { clinicas:solic, pedidos:novos, pacientes:msgs, notificacoes: solic+novos+msgs };
    }catch(e){ return {}; }
  })();

  const TITLES = {
    dashboard:  userType==="admin" ? "Dashboard — Admin Master" : `Dashboard — ${clinicaName||userName}`,
    clinicas:"Clínicas Licenciadas", pedidos:"Pedidos de Palmilhas", producao:"Painel de Produção",
    financeiro:"Gestão Financeira",  fechamento:"Fechamento Mensal",  agenda:"Agenda",  notificacoes:"Notificações",
    pacientes:"Pacientes",           ia:"IA Clínica ✦",               relatorios:"Relatórios & Analytics",
    config:"Configurações",          avaliacao:"Avaliação Postural",  academy:"FisioPiede Academy",  mensagens:"Mensagens",  marketing:"Marketing Hub",
  };

  const renderPage = () => {
    if(userType==="paciente") {
      if(page==="dashboard")  return <DashPaciente paciente={pacienteLogado} pedidos={pedidos.filter(p=>p.pacienteId===pacienteId || (!p.pacienteId && pacienteLogado && String(p.paciente||"").trim().toLowerCase()===(`${pacienteLogado.nome||""} ${pacienteLogado.sobrenome||""}`).trim().toLowerCase()))} consultas={consultas}/>;
      if(page==="patologia")  return <PatologiaPacientePage paciente={pacienteLogado}/>;
      if(page==="exercicios") return <ExerciciosPage paciente={pacienteLogado}/>;
      if(page==="mensagens")  return <MensagensPacientePage paciente={pacienteLogado}/>;
      if(page==="config")     return <ConfigPage userType={userType} paciente={pacienteLogado}/>;
      return <DashPaciente paciente={pacienteLogado} pedidos={pedidos.filter(p=>p.pacienteId===pacienteId || (!p.pacienteId && pacienteLogado && String(p.paciente||"").trim().toLowerCase()===(`${pacienteLogado.nome||""} ${pacienteLogado.sobrenome||""}`).trim().toLowerCase()))} consultas={consultas}/>;
    }
    if(userType==="clinica" || userType==="colaborador") {
      const ehColab = userType==="colaborador";
      // Colaborador não acessa financeiro nem valores
      if(ehColab && page==="financeiro") {
        return <SemAcessoColaborador/>;
      }
      // Página de planos (acessível pelo banner "Ver planos")
      if(page==="planos") {
        return <UpgradePlano plano={planoClinica} modulo={null} clinicaNome={clinicaName} clinicaId={clinicaId} email={userEmail}/>;
      }
      // Bloqueia páginas fora do plano contratado
      if(modulosPermitidos && !modulosPermitidos.includes(page)) {
        return <UpgradePlano plano={planoClinica} modulo={page} clinicaNome={clinicaName} clinicaId={clinicaId} email={userEmail}/>;
      }
      if(page==="dashboard")  return <DashClinica pedidos={meusPedidos} pacientes={meusPacientes} clinicaObj={clinicaObj} hideValues={ehColab} onNavegar={(pg)=>setPage(pg)} planoIA={planoIAefetivo} consultas={clinicaId?consultas.filter(c=>c.clinicaId===clinicaId):consultas}/>;
      if(page==="pedidos")    return <PedidosPage pedidos={meusPedidos} setPedidos={setPedidos} isAdmin={false} clinicaId={clinicaId} clinicaName={clinicaName} pacientes={meusPacientes}/>;
      if(page==="pacientes")  return <PacientesPage pacientes={meusPacientes} setPacientes={setPacientes} isAdmin={false} clinicaId={clinicaId} clinicaName={clinicaName} planoClinica={planoClinica} planoIA={planoIAefetivo}/>;
      if(page==="avaliacao")  return <AvaliacaoPage pacientes={meusPacientes}/>;
      if(page==="agenda")     return <AgendaPage consultas={clinicaId?consultas.filter(c=>c.clinicaId===clinicaId):consultas} setConsultas={setConsultas} pacientes={clinicaId?meusPacientes:pacientes} clinicaId={clinicaId} isAdmin={userType==="admin"}/>;
      if(page==="mensagens")  return <MensagensClinicaPage pacientes={meusPacientes} clinicaId={clinicaId} clinicaName={clinicaName}/>;
      if(page==="financeiro") return <FinanceiroClinica clinicaId={clinicaId} clinicaObj={clinicaObj} meusPedidos={meusPedidos} pacientes={meusPacientes}/>;
      if(page==="ia")         return <IAPage pacientes={meusPacientes} setPacientes={setPacientes} setPedidos={setPedidos} clinicaId={clinicaId} clinicaName={clinicaName} planoIA={planoIAefetivo}/>;
      if(page==="academy")    return <AcademyPage userName={userName} userType={userType} clinicaName={clinicaName} clinicaId={clinicaId} planoIA={planoIAefetivo}/>;
      if(page==="marketing")  return <MarketingPage clinicaName={clinicaName} clinicaObj={clinicaObj} isAdmin={false} clinicaId={clinicaId} planoIA={planoIAefetivo}/>;
      if(page==="config")     return <ConfigPage userType={userType} clinicaId={clinicaId}/>;
      return <Placeholder title={TITLES[page]||page} icon="⚙️"/>;
    }
    // admin — vê tudo
    if(page==="dashboard")  return <DashAdmin pedidos={pedidos} clinicas={clinicasPedidoCount} onNavegar={(pg)=>setPage(pg)}/>;
    if(page==="clinicas")   return <ClinicasPage clinicas={clinicasPedidoCount} setClinicas={setClinicas} pedidos={pedidos}/>;
    if(page==="pedidos")    return <PedidosPage pedidos={pedidos} setPedidos={setPedidos} isAdmin={true} clinicaId={null} clinicaName={null} pacientes={pacientes} onRecarregar={recarregarDados} onExcluir={excluirPedido}/>;
    if(page==="producao")   return <ProducaoPage pedidos={pedidos} setPedidos={setPedidos}/>;
    if(page==="financeiro") return <FinanceiroPage clinicas={clinicasPedidoCount} isAdmin={true} meusPedidos={pedidos}/>;
    if(page==="fechamento") return <FechamentoPage clinicas={clinicasPedidoCount} pedidos={pedidos}/>;
    if(page==="notificacoes") return <NotificacoesPage destino={"admin:master"} onNavegar={(pg)=>setPage(pg)} pedidos={pedidos} clinicas={clinicas} pacientes={pacientes}/>;
    if(page==="agenda")     return <AgendaPage consultas={clinicaId?consultas.filter(c=>c.clinicaId===clinicaId):consultas} setConsultas={setConsultas} pacientes={clinicaId?meusPacientes:pacientes} clinicaId={clinicaId} isAdmin={userType==="admin"}/>;
    if(page==="pacientes")  return <PacientesPage pacientes={pacientes} setPacientes={setPacientes} isAdmin={true} clinicaId={null} clinicaName={null} planoClinica={"Enterprise"} planoIA={"admin"}/>;
    if(page==="ia")         return <IAPage pacientes={pacientes} setPacientes={setPacientes} setPedidos={setPedidos} clinicaId={null} clinicaName={null} planoIA="admin"/>;
    if(page==="academy")    return <AcademyPage userName={userName} userType={userType} clinicaName={clinicaName} clinicaId={null} planoIA="admin"/>;
    if(page==="marketing")  return <MarketingPage clinicaName={null} clinicaObj={null} isAdmin={true} clinicaId={null} planoIA="admin"/>;
    if(page==="relatorios") return <RelatoriosPage pedidos={pedidos} clinicas={clinicasPedidoCount}/>;
    if(page==="config")     return <ConfigPage userType={userType}/>;
    return <Placeholder title={TITLES[page]||page} icon="⚙️"/>;
  };

  // Clínica pedidos count computed from real data (não o campo .pedidos do objeto)
  const clinicasPedidoCount = clinicas.map(c => ({
    ...c,
    pedidosReal: pedidos.filter(p => p.clinicaId === c.id).length
  }));

  return (
    <div>
      <GS/><GridBg/>
      {screen==="splash" && <Splash onDone={()=>setScreen("login")}/>}
      {screen==="login"  && <Login onLogin={login} clinicas={clinicas} pacientes={pacientes}/>}
      {screen==="app" && (
        <div style={{display:"flex",minHeight:"100vh"}}>
          <Sidebar nav={nav} active={page} setActive={setPage} userType={userType} userName={clinicaName||userName} onLogout={logout} plano={userType==="clinica"?planoClinica:null} bloqueados={modulosBloqueados} isMobile={isMobile} mobileOpen={drawerOpen} onCloseMobile={()=>setDrawerOpen(false)} badges={navBadges}/>
          <div style={{flex:1,display:"flex",flexDirection:"column",minWidth:0}}>
            <Topbar title={TITLES[page]||page} sub={userEmail} clinicaName={clinicaName} isAdmin={userType==="admin"} onLogout={logout} notifDestino={userType==="paciente"?("paciente:"+pacienteId):(userType==="clinica"||userType==="colaborador")?("clinica:"+clinicaId):"admin:master"} onMenu={()=>setDrawerOpen(true)} isMobile={isMobile} onNavegar={(pg)=>setPage(pg)}/>
            {sincronizando && <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"7px 12px",background:`${C.accent}12`,borderBottom:`1px solid ${C.accent}28`,fontSize:12,color:C.accent,fontWeight:600}}><Spin sz={13}/> Sincronizando seus dados...</div>}
            {userType==="clinica" && emTrial && (
              <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,padding:"10px 16px",background:"linear-gradient(90deg,#8B5CF615,#F59E0B15)",borderBottom:"1px solid #8B5CF630",fontSize:13}}>
                <span style={{fontSize:16}}>🎁</span>
                <span style={{color:C.text,fontWeight:600}}>Período de teste: <span style={{color:C.purple}}>{diasRestantesTrial} {diasRestantesTrial===1?"dia restante":"dias restantes"}</span> com todos os recursos liberados</span>
                <Btn v="primary" sz="sm" onClick={()=>setPage("planos")} style={{marginLeft:6}}>Ver planos</Btn>
              </div>
            )}
            {userType==="clinica" && !emTrial && assinatura && assinatura.status==="Em atraso" && (
              <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,padding:"10px 16px",background:"#F9731618",borderBottom:"1px solid #F9731640",fontSize:13}}>
                <span style={{fontSize:16}}>⚠️</span>
                <span style={{color:C.text,fontWeight:600}}>Sua assinatura está <span style={{color:"#F97316"}}>em atraso</span>. Regularize em até {TOLERANCIA_DIAS + assinatura.diasRestantes} dia(s) para não perder o acesso aos recursos.</span>
                <Btn v="primary" sz="sm" onClick={()=>setPage("config")} style={{marginLeft:6}}>Regularizar</Btn>
              </div>
            )}
            {userType==="clinica" && assinaturaBloqueada && (
              <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,padding:"10px 16px",background:"#EF444418",borderBottom:"1px solid #EF444440",fontSize:13}}>
                <span style={{fontSize:16}}>🔒</span>
                <span style={{color:C.text,fontWeight:600}}>Assinatura <span style={{color:"#EF4444"}}>{assinatura.status.toLowerCase()}</span>. Os recursos premium estão bloqueados até a regularização do pagamento.</span>
                <Btn v="primary" sz="sm" onClick={()=>setPage("config")} style={{marginLeft:6}}>Regularizar agora</Btn>
              </div>
            )}
            {userType==="clinica" && !emTrial && assinatura && assinatura.status==="Ativa" && assinatura.diasRestantes!==null && assinatura.diasRestantes<=7 && assinatura.diasRestantes>=0 && (
              <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,padding:"10px 16px",background:"#F59E0B15",borderBottom:"1px solid #F59E0B30",fontSize:13}}>
                <span style={{fontSize:16}}>📅</span>
                <span style={{color:C.text,fontWeight:600}}>Sua assinatura vence em <span style={{color:C.amber}}>{assinatura.diasRestantes===0?"hoje":`${assinatura.diasRestantes} dia(s)`}</span>.</span>
                <Btn v="primary" sz="sm" onClick={()=>setPage("config")} style={{marginLeft:6}}>Renovar</Btn>
              </div>
            )}
            <main style={{flex:1,overflowY:"auto"}}><ErrorBoundary key={page}>{renderPage()}</ErrorBoundary></main>
          </div>
        </div>
      )}
    </div>
  );
}

// 🛡️ Escudo total: o app INTEIRO (inclusive Login, Sidebar e modais) protegido contra tela branca.
export default function App(){
  return <ErrorBoundary nivel="sistema"><AppCore/></ErrorBoundary>;
}
