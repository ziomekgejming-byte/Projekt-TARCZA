const cards = [
	["Status drona", "Gotowy do lotu", "Bateria 92%"],
	["Lokalizacja", "Sektor A-12", "GPS: dokładny"],
	["Czas lotu", "2 godz. 18 min", "Dzisiaj"],
	["Następny przegląd", "Za 12 godz.", "Brak usterek"],
];

export default function DashboardPage() {
	return (
		<main className="min-h-screen bg-slate-50 text-slate-900">
			<div className="mx-auto flex max-w-7xl">
				<aside className="hidden min-h-screen w-60 border-r bg-white p-6 md:block">
					<h1 className="mb-10 text-xl font-bold text-indigo-600">◆ Panel operatora</h1>
					<nav className="space-y-2 text-sm">
						<a href="#status" className="block rounded-lg bg-indigo-50 px-4 py-3 font-semibold text-indigo-700">Status drona</a>
						<a href="#misja" className="block rounded-lg px-4 py-3 text-slate-600 hover:bg-slate-50">Plan misji</a>
						<a href="#telemetria" className="block rounded-lg px-4 py-3 text-slate-600 hover:bg-slate-50">Telemetria</a>
						<a href="#przeglady" className="block rounded-lg px-4 py-3 text-slate-600 hover:bg-slate-50">Przeglądy</a>
					</nav>
				</aside>
				<section className="w-full p-5 sm:p-8">
					<header className="mb-8 flex items-center justify-between">
						<div><p className="text-sm text-slate-500">Panel zarządzania lotem</p><h2 className="text-2xl font-bold">Dron: SkyScout-01</h2></div>
						<div className="flex items-center gap-3"><button aria-label="Powiadomienia" className="rounded-lg border bg-white px-3 py-2">🔔</button><span className="rounded-full bg-indigo-100 px-3 py-2 text-sm font-semibold text-indigo-700">Operator</span></div>
					</header>
					<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
						{cards.map(([label, value, change]) => <div key={label} className="rounded-xl border bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">{label}</p><strong className="mt-2 block text-2xl">{value}</strong><span className="text-sm text-emerald-600">{change} <span className="text-slate-400">vs. poprzedni miesiąc</span></span></div>)}
					</div>
					<div className="mt-6 grid gap-6 lg:grid-cols-3">
						<section id="telemetria" className="rounded-xl border bg-white p-6 shadow-sm lg:col-span-2"><div className="mb-6 flex justify-between"><div><h3 className="font-semibold">Poziom baterii</h3><p className="text-sm text-slate-500">Ostatnie 7 odczytów</p></div><span className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">Stabilne</span></div><div className="flex h-52 items-end gap-3 border-b px-2">{[96,91,88,82,76,69,92].map((height, i) => <div key={i} className="flex h-full flex-1 flex-col justify-end gap-2"><div className="rounded-t bg-indigo-500" style={{height: `${height}%`}} /><span className="text-center text-xs text-slate-400">{["09:00","10:00","11:00","12:00","13:00","14:00","Teraz"][i]}</span></div>)}</div></section>
						<section id="misja" className="rounded-xl border bg-white p-6 shadow-sm"><h3 className="font-semibold">Przygotowanie do lotu</h3><p className="mb-5 text-sm text-slate-500">Lista kontrolna operatora</p>{["GPS i kompas", "Śmigła i kadłub", "Łączność z kontrolerem"].map((item) => <label key={item} className="mb-4 flex items-center gap-3 text-sm"><input type="checkbox" className="h-4 w-4 accent-indigo-600" />{item}</label>)}<button className="mt-2 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">Rozpocznij misję</button></section>
					</div>
					<section id="przeglady" className="mt-6 overflow-hidden rounded-xl border bg-white shadow-sm"><div className="flex justify-between p-6"><div><h3 className="font-semibold">Ostatnie loty</h3><p className="text-sm text-slate-500">Historia operacji drona</p></div><a href="#" className="text-sm text-indigo-600">Pełna historia</a></div><div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-sm"><thead className="border-y bg-slate-50 text-xs uppercase text-slate-500"><tr>{["Misja","Data","Czas lotu","Dystans","Status"].map(x => <th key={x} className="px-6 py-3">{x}</th>)}</tr></thead><tbody>{[["Obchód sektora A","Dzisiaj, 14:20","38 min","4,2 km","Zakończona"],["Inspekcja dachu","Dzisiaj, 10:05","24 min","2,1 km","Zakończona"],["Mapowanie terenu","Wczoraj, 16:40","51 min","6,8 km","Zakończona"]].map(row => <tr key={row[0]} className="border-b last:border-0">{row.map((cell, i) => <td key={i} className="px-6 py-4"><span className={i === 4 ? "rounded-full bg-emerald-50 px-3 py-1 text-xs text-emerald-700" : ""}>{cell}</span></td>)}</tr>)}</tbody></table></div></section>
				</section>
			</div>
		</main>
	);
}
