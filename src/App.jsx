import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabaseClient';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';

// Pon en false si todavía no configuras login ni políticas RLS en Supabase.
const REQUIRE_AUTH = true;

const CATEGORIAS_BASE = ['Comida', 'Transporte', 'Servicios', 'Compras', 'Entretenimiento', 'Salud', 'Hogar', 'Suscripciones', 'Educación', 'Sueldo', 'Otros'];
const PALETA = ['#B9A7FF', '#FF9E7A', '#6EC8FF', '#FFD166', '#F78FB3', '#8EE3A5', '#C4B5A0', '#7DE0E0'];

const PERIODOS = [
  { id: 'mes', label: 'Este mes', hero: 'Balance de este mes', vs: 'el mismo día del mes pasado' },
  { id: 'anterior', label: 'Mes pasado', hero: 'Balance del mes pasado', vs: 'el mes anterior' },
  { id: '30d', label: '30 días', hero: 'Balance de los últimos 30 días', vs: 'los 30 días previos' },
  { id: 'todo', label: 'Todo', hero: 'Balance total', vs: null },
];

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Instrument+Sans:wght@400;500;600&display=swap');
:root{color-scheme:dark;--bg:#12101E;--surface:#1B1830;--line:#2E2A4A;--text:#EFEAFB;--muted:#9690B8;--in:#5EEAD4;--out:#FF6B81;--warn:#FFC857;--accent:#B9A7FF}
.app{min-height:100vh;background:radial-gradient(60rem 40rem at 10% -10%,rgba(185,167,255,.16),transparent 60%),radial-gradient(50rem 36rem at 100% 110%,rgba(255,107,129,.12),transparent 60%),var(--bg);color:var(--text);font-family:'Instrument Sans',system-ui,sans-serif}
.fd{font-family:'Bricolage Grotesque','Instrument Sans',system-ui,sans-serif}
.nums{font-variant-numeric:tabular-nums}
.panel{background:color-mix(in srgb,var(--surface) 88%,transparent);border:1px solid var(--line);border-radius:28px;backdrop-filter:blur(10px)}
.pop{animation:pop 1.6s ease-out}
@keyframes pop{0%{box-shadow:0 0 0 0 rgba(185,167,255,.7);background:rgba(185,167,255,.18)}100%{box-shadow:0 0 0 14px rgba(185,167,255,0)}}
.pulse{animation:pulse 2s infinite}
@keyframes pulse{50%{opacity:.35}}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;

const INPUT = 'w-full rounded-xl bg-white/5 border border-[var(--line)] px-3 py-2 placeholder:text-[var(--muted)] focus:border-[var(--accent)]';

/* ---------- utilidades ---------- */
const tipoDe = (g) => g.tipo ?? (g.es_gasto === false ? 'ingreso' : 'gasto');
const monedaDe = (g) => (g.moneda || 'MXN').toUpperCase();
const key = (d) => d.toLocaleDateString('sv-SE');
const colorDe = (name) => PALETA[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETA.length];
const fmt = (n, m = 'MXN') => {
  try { return new Intl.NumberFormat('es-MX', { style: 'currency', currency: m }).format(n); }
  catch { return `$${Number(n).toFixed(2)}`; }
};
const diaLabel = (d) => {
  const k = key(d);
  if (k === key(new Date())) return 'Hoy';
  if (k === key(new Date(Date.now() - 864e5))) return 'Ayer';
  return d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'short' });
};

function rango(id) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const iniMes = new Date(y, m, 1);
  if (id === 'mes') {
    const prevIni = new Date(y, m - 1, 1);
    const prevFin = new Date(Math.min(+iniMes, +prevIni + (+now - +iniMes)));
    return { ini: iniMes, fin: new Date(y, m + 1, 1), prev: { ini: prevIni, fin: prevFin } };
  }
  if (id === 'anterior') {
    const ini = new Date(y, m - 1, 1);
    return { ini, fin: iniMes, prev: { ini: new Date(y, m - 2, 1), fin: ini } };
  }
  if (id === '30d') {
    const ini = new Date(+now - 30 * 864e5);
    return { ini, fin: null, prev: { ini: new Date(+now - 60 * 864e5), fin: ini } };
  }
  return { ini: null, fin: null, prev: null };
}
const enRango = (g, r) => {
  const t = new Date(g.created_at);
  return (!r.ini || t >= r.ini) && (!r.fin || t < r.fin);
};

function exportar(rows) {
  const esc = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = "'" + s; // evita fórmulas en Excel
    return `"${s.replace(/"/g, '""')}"`;
  };
  const head = ['fecha', 'tipo', 'comercio', 'categoria', 'monto', 'moneda'];
  const csv = [head.join(','), ...rows.map((g) => [g.created_at, tipoDe(g), g.comercio, g.categoria, g.monto, g.moneda].map(esc).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'movimientos.csv'; a.click();
  URL.revokeObjectURL(url);
}

/* ---------- piezas pequeñas ---------- */
const Shell = ({ children }) => (
  <div className="app"><style>{CSS}</style>{children}</div>
);
const Chip = ({ activo, children, ...p }) => (
  <button {...p} aria-pressed={!!activo}
    className={`px-3.5 py-1.5 rounded-full text-sm transition-colors ${activo ? 'bg-[var(--text)] text-[var(--bg)] font-semibold' : 'bg-white/5 text-[var(--muted)] hover:text-[var(--text)]'}`}>
    {children}
  </button>
);
const Boton = (p) => (
  <button {...p} className="px-3.5 py-1.5 rounded-full text-sm text-[var(--muted)] hover:text-[var(--text)] border border-[var(--line)] transition-colors" />
);

function TipDia({ active, payload, moneda }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="panel px-3 py-2 text-sm" style={{ borderRadius: 14 }}>
      <div className="text-[var(--muted)]">{payload[0].payload.etiqueta}</div>
      {payload.filter((p) => p.value !== 0).map((p) => (
        <div key={p.dataKey} style={{ color: p.dataKey === 'ingreso' ? 'var(--in)' : 'var(--out)' }}>
          {p.dataKey === 'ingreso' ? 'Ingresos' : 'Gastos'}: {fmt(Math.abs(p.value), moneda)}
        </div>
      ))}
    </div>
  );
}

function Presupuesto({ valor, usado, moneda, onGuardar }) {
  const [edit, setEdit] = useState(false);
  const [txt, setTxt] = useState('');
  const guardar = () => {
    const n = parseFloat(txt);
    onGuardar(Number.isFinite(n) && n > 0 ? n : null);
    setEdit(false);
  };
  if (edit) {
    return (
      <input autoFocus type="number" min="0" inputMode="decimal" value={txt} aria-label="Presupuesto mensual"
        onChange={(e) => setTxt(e.target.value)} onBlur={guardar}
        onKeyDown={(e) => { if (e.key === 'Enter') guardar(); if (e.key === 'Escape') setEdit(false); }}
        placeholder="Monto mensual" className={`${INPUT} mt-2 !py-1 text-sm`} />
    );
  }
  if (!valor) {
    return <button onClick={() => { setTxt(''); setEdit(true); }} className="mt-1 text-xs text-[var(--muted)] hover:text-[var(--text)]">Fijar presupuesto mensual</button>;
  }
  const pct = usado / valor;
  const color = pct > 1 ? 'var(--out)' : pct >= 0.8 ? 'var(--warn)' : 'var(--accent)';
  return (
    <div className="mt-2">
      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full transition-[width] duration-500" style={{ width: `${Math.min(100, pct * 100)}%`, background: color }} />
      </div>
      <button onClick={() => { setTxt(String(valor)); setEdit(true); }} className="mt-1 text-xs text-[var(--muted)] hover:text-[var(--text)]">
        {fmt(usado, moneda)} de {fmt(valor, moneda)} este mes
      </button>
    </div>
  );
}

function Editor({ mov, categorias, moneda, onClose, onGuardado, onEliminado }) {
  const [comercio, setComercio] = useState(mov.comercio || '');
  const [categoria, setCategoria] = useState(mov.categoria || '');
  const [tipo, setTipo] = useState(tipoDe(mov));
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [seguro, setSeguro] = useState(false);

  useEffect(() => {
    const f = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [onClose]);

  async function guardar() {
    setBusy(true); setErr(null);
    const { data, error } = await supabase.from('gastos')
      .update({ comercio: comercio.trim(), categoria: categoria.trim() || 'Otros', tipo })
      .eq('id', mov.id).select().single();
    setBusy(false);
    if (error) return setErr(error.message);
    onGuardado(data);
  }
  async function eliminar() {
    if (!seguro) return setSeguro(true);
    setBusy(true); setErr(null);
    const { error } = await supabase.from('gastos').delete().eq('id', mov.id);
    setBusy(false);
    if (error) return setErr(error.message);
    onEliminado(mov.id);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Editar movimiento" onClick={(e) => e.stopPropagation()} className="panel w-full max-w-md p-6 space-y-4">
        <div>
          <h2 className="fd text-2xl font-bold">Editar movimiento</h2>
          <p className="nums text-[var(--muted)]">{fmt(Number(mov.monto), moneda)}</p>
        </div>
        <div className="flex gap-2">
          <Chip activo={tipo === 'gasto'} onClick={() => setTipo('gasto')}>Gasto</Chip>
          <Chip activo={tipo === 'ingreso'} onClick={() => setTipo('ingreso')}>Ingreso</Chip>
        </div>
        <label className="block text-sm text-[var(--muted)]">Comercio
          <input value={comercio} onChange={(e) => setComercio(e.target.value)} className={`${INPUT} mt-1 text-[var(--text)]`} />
        </label>
        <label className="block text-sm text-[var(--muted)]">Categoría
          <input list="cats" value={categoria} onChange={(e) => setCategoria(e.target.value)} className={`${INPUT} mt-1 text-[var(--text)]`} />
          <datalist id="cats">{categorias.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
        {err && <p className="text-sm text-[var(--out)]">No se pudo guardar: {err}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          <button onClick={eliminar} disabled={busy} className="text-sm text-[var(--out)] hover:underline">
            {seguro ? 'Confirmar eliminación' : 'Eliminar movimiento'}
          </button>
          <div className="flex gap-2">
            <Boton onClick={onClose}>Cancelar</Boton>
            <button onClick={guardar} disabled={busy} className="px-4 py-1.5 rounded-full text-sm font-semibold bg-[var(--accent)] text-[var(--bg)] disabled:opacity-50">
              {busy ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SaldoEditor({ inicial, moneda, onGuardar, onCancelar }) {
  const [txt, setTxt] = useState(inicial !== null ? inicial.toFixed(2) : '');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function enviar(e) {
    e.preventDefault();
    const n = parseFloat(txt);
    if (!Number.isFinite(n)) return setErr('Escribe un monto válido.');
    setBusy(true); setErr(null);
    const msg = await onGuardar(n);
    setBusy(false);
    if (msg) setErr(`No se pudo guardar: ${msg}`);
  }

  return (
    <form onSubmit={enviar} className="mt-4 flex flex-wrap items-center gap-2">
      <input autoFocus type="number" step="0.01" inputMode="decimal" value={txt} onChange={(e) => setTxt(e.target.value)}
        placeholder={`Saldo actual en ${moneda}`} aria-label="Saldo actual de tu cuenta" className={INPUT} style={{ maxWidth: '14rem' }} />
      <button disabled={busy} className="px-4 py-1.5 rounded-full text-sm font-semibold bg-[var(--accent)] text-[var(--bg)] disabled:opacity-50">
        {busy ? 'Guardando…' : 'Guardar saldo'}
      </button>
      <Boton type="button" onClick={onCancelar}>Cancelar</Boton>
      {err && <p className="w-full text-sm text-[var(--out)]">{err}</p>}
    </form>
  );
}

const API = import.meta.env.VITE_API_URL;
const TIPOS_RESUMEN = [
  { id: 'semanal', label: 'Semanal' },
  { id: 'mes_en_curso', label: 'Este mes' },
  { id: 'mes_anterior', label: 'Mes pasado' },
];

function Resumen() {
  const [tipo, setTipo] = useState('semanal');
  const [items, setItems] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const cargar = useCallback(async () => {
    const { data } = await supabase.from('resumenes').select('id, tipo, texto, created_at').order('created_at', { ascending: false }).limit(30);
    const m = {};
    (data ?? []).forEach((r) => { if (!m[r.tipo]) m[r.tipo] = r; });
    setItems(m);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  async function generar() {
    setBusy(true); setErr(null);
    try {
      if (!API) throw new Error('Falta la variable VITE_API_URL');
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Inicia sesión para generar resúmenes');
      const r = await fetch(`${API}/api/resumen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ tipo, enviar: false }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
      await cargar();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const actual = items[tipo];
  return (
    <section className="panel p-6 mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="fd text-xl font-bold">Resumen con IA</h2>
        <div className="flex flex-wrap gap-2">
          {TIPOS_RESUMEN.map((t) => <Chip key={t.id} activo={tipo === t.id} onClick={() => setTipo(t.id)}>{t.label}</Chip>)}
        </div>
      </div>
      {actual ? (
        <>
          <p className="whitespace-pre-line leading-relaxed max-w-prose">{actual.texto}</p>
          <p className="text-sm text-[var(--muted)] mt-3">
            Generado el {new Date(actual.created_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </p>
        </>
      ) : (
        <p className="text-[var(--muted)]">Aún no hay un resumen de este tipo. Pulsa «Generar ahora» para crear el primero.</p>
      )}
      {err && <p className="text-sm text-[var(--out)] mt-3">No se pudo generar: {err}</p>}
      <div className="mt-4">
        <button onClick={generar} disabled={busy} className="px-4 py-1.5 rounded-full text-sm font-semibold bg-[var(--accent)] text-[var(--bg)] disabled:opacity-50">
          {busy ? 'Generando…' : 'Generar ahora'}
        </button>
      </div>
    </section>
  );
}

function Login() {
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  async function entrar(e) {
    e.preventDefault(); setBusy(true); setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
    setBusy(false);
    if (error) setErr('Correo o contraseña incorrectos.');
  }
  return (
    <Shell>
      <div className="min-h-screen grid place-items-center p-4">
        <form onSubmit={entrar} className="panel p-8 w-full max-w-sm space-y-4">
          <h1 className="fd text-3xl font-extrabold">Mi dinero</h1>
          <p className="text-[var(--muted)]">Entra para ver tus movimientos.</p>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Correo" aria-label="Correo" className={INPUT} />
          <input type="password" required value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Contraseña" aria-label="Contraseña" className={INPUT} />
          {err && <p className="text-sm text-[var(--out)]">{err}</p>}
          <button disabled={busy} className="w-full py-2 rounded-full font-semibold bg-[var(--accent)] text-[var(--bg)] disabled:opacity-50">
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </Shell>
  );
}

/* ---------- dashboard ---------- */
function Dashboard() {
  const [gastos, setGastos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [vivo, setVivo] = useState(false);
  const [nuevoId, setNuevoId] = useState(null);
  const [periodo, setPeriodo] = useState('mes');
  const [monedaSel, setMonedaSel] = useState(null);
  const [filtroTipo, setFiltroTipo] = useState('todos');
  const [busqueda, setBusqueda] = useState('');
  const [limite, setLimite] = useState(40);
  const [editando, setEditando] = useState(null);
  const [saldos, setSaldos] = useState({});
  const [editandoSaldo, setEditandoSaldo] = useState(false);
  const [presupuestos, setPresupuestos] = useState(() => {
    try { return JSON.parse(localStorage.getItem('presupuestos') || '{}'); } catch { return {}; }
  });

  const cargar = useCallback(async () => {
    setLoading(true); setError(null);
    const { data, error } = await supabase.from('gastos').select('*').order('created_at', { ascending: false }).limit(2000);
    if (error) setError(error.message); else setGastos(data ?? []);
    const { data: sd } = await supabase.from('saldos').select('*'); // si la tabla aún no existe, simplemente no hay saldo
    setSaldos(Object.fromEntries((sd ?? []).map((s) => [s.moneda, s])));
    setLoading(false);
  }, []);

  useEffect(() => {
    cargar();
    const ch = supabase.channel('gastos-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gastos' }, (p) => {
        if (p.eventType === 'INSERT') {
          setGastos((prev) => (prev.some((g) => g.id === p.new.id) ? prev : [p.new, ...prev]));
          setNuevoId(p.new.id);
          setTimeout(() => setNuevoId(null), 5000);
        } else if (p.eventType === 'UPDATE') {
          setGastos((prev) => prev.map((g) => (g.id === p.new.id ? p.new : g)));
        } else if (p.eventType === 'DELETE') {
          setGastos((prev) => prev.filter((g) => g.id !== p.old.id));
        }
      })
      .subscribe((s) => setVivo(s === 'SUBSCRIBED'));
    return () => { supabase.removeChannel(ch); };
  }, [cargar]);

  const monedas = useMemo(() => {
    const c = {};
    gastos.forEach((g) => { c[monedaDe(g)] = (c[monedaDe(g)] || 0) + 1; });
    return Object.keys(c).sort((a, b) => c[b] - c[a]);
  }, [gastos]);
  const moneda = monedaSel && monedas.includes(monedaSel) ? monedaSel : monedas[0] || 'MXN';

  const delMoneda = useMemo(() => gastos.filter((g) => monedaDe(g) === moneda), [gastos, moneda]);
  const r = useMemo(() => rango(periodo), [periodo]);
  const enPeriodo = useMemo(() => delMoneda.filter((g) => enRango(g, r)), [delMoneda, r]);

  const suma = (arr, t) => arr.filter((g) => tipoDe(g) === t).reduce((a, g) => a + Number(g.monto || 0), 0);
  const gastosT = suma(enPeriodo, 'gasto');
  const ingresosT = suma(enPeriodo, 'ingreso');
  const balance = ingresosT - gastosT;
  const gastosPrev = r.prev ? suma(delMoneda.filter((g) => enRango(g, r.prev)), 'gasto') : null;
  const delta = gastosPrev > 0 ? ((gastosT - gastosPrev) / gastosPrev) * 100 : null;
  const pctGasto = ingresosT > 0 ? Math.min(100, (gastosT / ingresosT) * 100) : gastosT > 0 ? 100 : 0;

  // Saldo = el monto que fijaste + ingresos - gastos registrados desde ese momento.
  const base = saldos[moneda];
  const saldo = base
    ? Number(base.monto) + suma(delMoneda.filter((g) => new Date(g.created_at) > new Date(base.desde)), 'ingreso')
      - suma(delMoneda.filter((g) => new Date(g.created_at) > new Date(base.desde)), 'gasto')
    : null;
  const valorHero = saldo !== null ? saldo : balance;

  async function guardarSaldo(monto) {
    const { data, error } = await supabase.from('saldos')
      .upsert({ moneda, monto, desde: new Date().toISOString() }, { onConflict: 'moneda' }).select().single();
    if (error) return error.message;
    setSaldos((p) => ({ ...p, [moneda]: data }));
    setEditandoSaldo(false);
    return null;
  }

  const porCategoria = useMemo(() => {
    const m = {};
    enPeriodo.filter((g) => tipoDe(g) === 'gasto').forEach((g) => {
      const c = g.categoria || 'Otros';
      m[c] = (m[c] || 0) + Number(g.monto || 0);
    });
    return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [enPeriodo]);

  const gastoMesCat = useMemo(() => {
    const rm = rango('mes'), m = {};
    delMoneda.filter((g) => tipoDe(g) === 'gasto' && enRango(g, rm)).forEach((g) => {
      const c = g.categoria || 'Otros';
      m[c] = (m[c] || 0) + Number(g.monto || 0);
    });
    return m;
  }, [delMoneda]);

  const fijarPresupuesto = (cat, n) => {
    setPresupuestos((prev) => {
      const next = { ...prev };
      const k = `${moneda}:${cat}`;
      if (n) next[k] = n; else delete next[k];
      try { localStorage.setItem('presupuestos', JSON.stringify(next)); } catch { /* sin storage */ }
      return next;
    });
  };

  const dias = useMemo(() => {
    const hoy = new Date();
    let ini = r.ini ? new Date(r.ini) : enPeriodo.length ? new Date(Math.min(...enPeriodo.map((g) => +new Date(g.created_at)))) : new Date(hoy);
    ini.setHours(0, 0, 0, 0);
    const fin = r.fin ? new Date(Math.min(+r.fin - 1, +hoy)) : new Date(hoy);
    fin.setHours(0, 0, 0, 0);
    const tope = new Date(fin); tope.setDate(tope.getDate() - 44);
    if (ini < tope) ini = tope;
    const mapa = {};
    enPeriodo.forEach((g) => {
      const k = key(new Date(g.created_at));
      mapa[k] = mapa[k] || { ingreso: 0, gasto: 0 };
      mapa[k][tipoDe(g)] += Number(g.monto || 0);
    });
    const out = [];
    for (let d = new Date(ini); d <= fin; d.setDate(d.getDate() + 1)) {
      const v = mapa[key(d)] || { ingreso: 0, gasto: 0 };
      out.push({ dia: d.getDate(), etiqueta: d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }), ingreso: v.ingreso, gasto: -v.gasto });
    }
    return out;
  }, [enPeriodo, r]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return enPeriodo.filter((g) =>
      (filtroTipo === 'todos' || tipoDe(g) === filtroTipo) &&
      (!q || (g.comercio || '').toLowerCase().includes(q) || (g.categoria || '').toLowerCase().includes(q)));
  }, [enPeriodo, filtroTipo, busqueda]);

  const grupos = useMemo(() => {
    const out = [];
    visibles.slice(0, limite).forEach((g) => {
      const d = new Date(g.created_at), k = key(d);
      let last = out[out.length - 1];
      if (!last || last.k !== k) { last = { k, label: diaLabel(d), items: [] }; out.push(last); }
      last.items.push(g);
    });
    return out;
  }, [visibles, limite]);

  const categorias = useMemo(() => [...new Set([...CATEGORIAS_BASE, ...gastos.map((g) => g.categoria).filter(Boolean)])], [gastos]);
  const per = PERIODOS.find((p) => p.id === periodo);

  return (
    <Shell>
      <div className="max-w-6xl mx-auto px-4 sm:px-8 pb-16">
        <header className="flex items-center justify-between pt-6">
          <div className="flex items-center gap-3">
            <span className="fd text-xl font-extrabold">Mi dinero</span>
            <span className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
              <span className={`size-2 rounded-full ${vivo ? 'bg-[var(--in)] pulse' : 'bg-[var(--muted)]'}`} />
              {vivo ? 'En vivo' : 'Sin conexión'}
            </span>
          </div>
          <div className="flex gap-2">
            <Boton onClick={() => exportar(visibles)}>Exportar CSV</Boton>
            {REQUIRE_AUTH && <Boton onClick={() => supabase.auth.signOut()}>Salir</Boton>}
          </div>
        </header>

        {/* Hero */}
        <section className="pt-12 pb-8">
          <p className="text-lg text-[var(--muted)]">{saldo !== null ? 'Saldo en tu cuenta' : per.hero}</p>
          <h1 className="fd nums font-extrabold leading-none tracking-tight text-[clamp(3rem,11vw,7.5rem)] mt-2"
            style={{ color: valorHero < 0 ? 'var(--out)' : saldo !== null ? 'var(--text)' : 'var(--in)' }}>
            {valorHero < 0 && '−'}{fmt(Math.abs(valorHero), moneda)}
          </h1>
          {saldo !== null && !editandoSaldo && (
            <>
              <p className="mt-3 text-[var(--muted)]">
                {per.hero}:{' '}
                <span className="nums" style={{ color: balance >= 0 ? 'var(--in)' : 'var(--out)' }}>
                  {balance >= 0 ? '+' : '−'}{fmt(Math.abs(balance), moneda)}
                </span>
              </p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Parte del saldo que fijaste el {new Date(base.desde).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })} y suma lo que entra y resta lo que sale.{' '}
                <button onClick={() => setEditandoSaldo(true)} className="underline underline-offset-4 hover:text-[var(--text)]">Corregir saldo</button>
              </p>
            </>
          )}
          {saldo === null && !editandoSaldo && (
            <p className="mt-3 text-[var(--muted)]">
              ¿Cuánto tienes hoy en tu cuenta?{' '}
              <button onClick={() => setEditandoSaldo(true)} className="underline underline-offset-4 hover:text-[var(--text)]">Fijar mi saldo</button>
              {' '}y se ajustará con cada ingreso y gasto.
            </p>
          )}
          {editandoSaldo && (
            <SaldoEditor inicial={saldo} moneda={moneda} onGuardar={guardarSaldo} onCancelar={() => setEditandoSaldo(false)} />
          )}
          {delta !== null && per.vs && (
            <p className="mt-3 text-[var(--muted)]">
              Gastas <span style={{ color: delta <= 0 ? 'var(--in)' : 'var(--out)' }}>{Math.abs(delta).toFixed(0)}% {delta <= 0 ? 'menos' : 'más'}</span> que {per.vs}.
            </p>
          )}
          <div className="mt-8">
            <div className="h-5 rounded-full overflow-hidden flex bg-white/5" role="img"
              aria-label={`Gastaste ${fmt(gastosT, moneda)} de ${fmt(ingresosT, moneda)} ingresados`}>
              <div className="transition-[width] duration-700" style={{ width: `${pctGasto}%`, background: 'var(--out)' }} />
              <div className="transition-[width] duration-700" style={{ width: `${100 - pctGasto}%`, background: ingresosT > 0 ? 'var(--in)' : 'transparent' }} />
            </div>
            <div className="flex justify-between mt-2 text-sm nums">
              <span style={{ color: 'var(--out)' }}>Gastaste {fmt(gastosT, moneda)}</span>
              <span style={{ color: 'var(--in)' }}>Ingresaste {fmt(ingresosT, moneda)}</span>
            </div>
          </div>
        </section>

        {/* Controles */}
        <div className="flex flex-wrap items-center gap-2 mb-6">
          {PERIODOS.map((p) => <Chip key={p.id} activo={periodo === p.id} onClick={() => { setPeriodo(p.id); setLimite(40); }}>{p.label}</Chip>)}
          {monedas.length > 1 && <span className="w-px h-5 bg-white/15 mx-1" />}
          {monedas.length > 1 && monedas.map((m) => <Chip key={m} activo={moneda === m} onClick={() => setMonedaSel(m)}>{m}</Chip>)}
        </div>

        {error && (
          <div className="panel p-5 mb-6 text-sm" style={{ borderColor: 'var(--out)' }}>
            <p className="font-semibold text-[var(--out)]">No se pudieron cargar los movimientos.</p>
            <p className="text-[var(--muted)] mt-1">{error}. Revisa que tu usuario tenga una política de lectura en la tabla gastos.</p>
          </div>
        )}

        <Resumen />

        {/* Flujo diario */}
        <section className="panel p-6 mb-6">
          <h2 className="fd text-xl font-bold mb-2">Día a día</h2>
          <p className="text-sm text-[var(--muted)] mb-4">Lo que entra sube, lo que sale baja.</p>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dias} stackOffset="sign" margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                <XAxis dataKey="dia" tickLine={false} axisLine={false} interval="preserveStartEnd" tick={{ fill: '#9690B8', fontSize: 12 }} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,.04)' }} content={<TipDia moneda={moneda} />} />
                <ReferenceLine y={0} stroke="#2E2A4A" />
                <Bar dataKey="ingreso" stackId="d" fill="#5EEAD4" radius={[6, 6, 0, 0]} />
                <Bar dataKey="gasto" stackId="d" fill="#FF6B81" radius={[0, 0, 6, 6]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Categorías y presupuestos */}
          <section className="panel p-6 lg:col-span-5 self-start">
            <h2 className="fd text-xl font-bold mb-4">En qué gastas</h2>
            {porCategoria.length === 0 ? (
              <p className="text-[var(--muted)] py-6">Aún no hay gastos en este periodo.</p>
            ) : (
              <>
                <div className="flex h-3 rounded-full overflow-hidden gap-0.5 mb-6">
                  {porCategoria.map((c) => (
                    <div key={c.name} title={c.name} style={{ width: `${(c.value / gastosT) * 100}%`, background: colorDe(c.name) }} />
                  ))}
                </div>
                <ul className="space-y-5">
                  {porCategoria.map((c) => (
                    <li key={c.name}>
                      <div className="flex items-center gap-2">
                        <span className="size-2.5 rounded-full" style={{ background: colorDe(c.name) }} />
                        <span className="flex-1 truncate">{c.name}</span>
                        <span className="nums text-sm text-[var(--muted)]">{((c.value / gastosT) * 100).toFixed(0)}%</span>
                        <span className="nums font-semibold w-28 text-right">{fmt(c.value, moneda)}</span>
                      </div>
                      <Presupuesto valor={presupuestos[`${moneda}:${c.name}`]} usado={gastoMesCat[c.name] || 0} moneda={moneda}
                        onGuardar={(n) => fijarPresupuesto(c.name, n)} />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {/* Movimientos */}
          <section className="panel p-6 lg:col-span-7">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h2 className="fd text-xl font-bold">Movimientos</h2>
              <div className="flex gap-2">
                <Chip activo={filtroTipo === 'todos'} onClick={() => setFiltroTipo('todos')}>Todos</Chip>
                <Chip activo={filtroTipo === 'gasto'} onClick={() => setFiltroTipo('gasto')}>Gastos</Chip>
                <Chip activo={filtroTipo === 'ingreso'} onClick={() => setFiltroTipo('ingreso')}>Ingresos</Chip>
              </div>
            </div>
            <input type="search" value={busqueda} onChange={(e) => { setBusqueda(e.target.value); setLimite(40); }}
              placeholder="Buscar comercio o categoría" aria-label="Buscar movimientos" className={`${INPUT} mb-4`} />

            {loading ? (
              <div className="space-y-3">{[0, 1, 2, 3].map((i) => <div key={i} className="h-14 rounded-2xl bg-white/5 animate-pulse" />)}</div>
            ) : gastos.length === 0 ? (
              <p className="text-[var(--muted)] py-10 text-center">Todavía no hay movimientos. Cuando tu banco mande una notificación, aparecerá aquí en segundos.</p>
            ) : visibles.length === 0 ? (
              <p className="text-[var(--muted)] py-10 text-center">Ningún movimiento coincide con este filtro.</p>
            ) : (
              <>
                {grupos.map((gr) => (
                  <div key={gr.k} className="mb-4">
                    <h3 className="text-sm text-[var(--muted)] mb-1 capitalize">{gr.label}</h3>
                    {gr.items.map((g) => {
                      const ing = tipoDe(g) === 'ingreso';
                      return (
                        <button key={g.id} onClick={() => setEditando(g)}
                          className={`w-full text-left flex items-center gap-3 rounded-2xl px-3 py-3 transition-colors hover:bg-white/5 ${g.id === nuevoId ? 'pop' : ''}`}
                          style={ing ? { background: 'linear-gradient(90deg, color-mix(in srgb, var(--in) 14%, transparent), transparent)' } : undefined}>
                          <span className="grid place-items-center size-10 rounded-full shrink-0"
                            style={{ background: ing ? 'color-mix(in srgb, var(--in) 20%, transparent)' : 'rgba(255,255,255,.06)', color: ing ? 'var(--in)' : 'var(--muted)' }}>
                            {ing ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{g.comercio || 'Sin comercio'}</span>
                            <span className="block text-sm text-[var(--muted)]">
                              {g.categoria || 'Otros'}, {new Date(g.created_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </span>
                          <span className="fd nums font-bold text-lg" style={{ color: ing ? 'var(--in)' : 'var(--text)' }}>
                            {ing ? '+' : '−'}{fmt(Number(g.monto), moneda)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
                {visibles.length > limite && <Boton onClick={() => setLimite((l) => l + 40)}>Mostrar más</Boton>}
              </>
            )}
          </section>
        </div>
      </div>

      {editando && (
        <Editor mov={editando} categorias={categorias} moneda={monedaDe(editando)} onClose={() => setEditando(null)}
          onGuardado={(nuevo) => { setGastos((p) => p.map((g) => (g.id === nuevo.id ? nuevo : g))); setEditando(null); }}
          onEliminado={(id) => { setGastos((p) => p.filter((g) => g.id !== id)); setEditando(null); }} />
      )}
    </Shell>
  );
}

/* ---------- raíz ---------- */
export default function App() {
  const [session, setSession] = useState(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (REQUIRE_AUTH) {
    if (session === undefined) return <Shell><div className="min-h-screen grid place-items-center text-[var(--muted)]">Cargando…</div></Shell>;
    if (!session) return <Login />;
  }
  return <Dashboard />;
}