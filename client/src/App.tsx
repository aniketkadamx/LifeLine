import { Activity, ShieldCheck, Database, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function App() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-center items-center p-6">
      <div className="max-w-xl w-full bg-white rounded-2xl shadow-sm border border-slate-200 p-8 space-y-6">
        <div className="flex items-center space-x-3">
          <div className="h-10 w-10 rounded-xl bg-teal-600 flex items-center justify-center text-white shadow-sm">
            <Activity className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">LifeLine</h1>
            <p className="text-sm text-slate-500">Digital Healthcare & Telemedicine Platform</p>
          </div>
        </div>

        <div className="border-t border-slate-100 pt-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-3">
            System Initialization Baseline
          </h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex items-center space-x-2 text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-100">
              <Layers className="h-4 w-4 text-teal-600" />
              <span>React 19 + Vite + TS</span>
            </div>
            <div className="flex items-center space-x-2 text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-100">
              <ShieldCheck className="h-4 w-4 text-teal-600" />
              <span>Tailwind + shadcn/ui</span>
            </div>
            <div className="flex items-center space-x-2 text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-100">
              <Database className="h-4 w-4 text-teal-600" />
              <span>Zustand + TanStack Query</span>
            </div>
            <div className="flex items-center space-x-2 text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-100">
              <Activity className="h-4 w-4 text-teal-600" />
              <span>Modular Monolith Ready</span>
            </div>
          </div>
        </div>

        <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 text-sm text-teal-900 flex items-center justify-between">
          <div>
            <span className="font-semibold">Repository Initialized:</span> Development structure ready for Phase 5 contracts.
          </div>
          <Button variant="default" size="sm" className="bg-teal-600 hover:bg-teal-700 text-white">
            Ready
          </Button>
        </div>
      </div>
    </div>
  );
}
