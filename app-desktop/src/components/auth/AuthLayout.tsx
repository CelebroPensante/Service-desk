import type { ReactNode } from "react";
import { Headphones } from "lucide-react";

interface AuthStat {
  valor: string;
  label: string;
}

interface AuthLayoutProps {
  heroTitle: string;
  heroDescription: string;
  children: ReactNode;
  stats?: AuthStat[];
}

export default function AuthLayout({
  heroTitle,
  heroDescription,
  children,
  stats,
}: AuthLayoutProps) {
  return (
    <div className="min-h-screen flex flex-row">
      <div className="flex flex-col justify-between p-12 bg-gradient-to-br from-blue-950 via-blue-800 to-sky-500 text-white basis-1/2 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center">
            <Headphones size={20} />
          </div>
          <div>
            <p className="font-semibold leading-tight">ServiceDesk</p>
            <p className="text-xs text-white/70 leading-tight">Plataforma de Suporte de TI</p>
          </div>
        </div>

        <div className="space-y-5">
          <h1 className="text-4xl font-semibold leading-tight max-w-md">{heroTitle}</h1>
          <p className="text-white/80 max-w-sm leading-relaxed">{heroDescription}</p>

          {stats && (
            <div className="flex gap-3 pt-2">
              {stats.map((stat) => (
                <div key={stat.label} className="rounded-lg bg-white/10 px-4 py-3 min-w-[92px]">
                  <p className="font-semibold">{stat.valor}</p>
                  <p className="text-xs text-white/70">{stat.label}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="text-xs text-white/50">© 2026 ServiceDesk. Todos os direitos reservados.</p>
      </div>

      <div className="basis-1/2 flex items-center justify-center bg-white px-6 py-12">
        {children}
      </div>
    </div>
  );
}