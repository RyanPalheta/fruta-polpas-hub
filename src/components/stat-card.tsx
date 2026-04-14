interface StatCardProps {
  label: string;
  value: string | number;
  color?: string;
}

export function StatCard({ label, value, color = "text-primary" }: StatCardProps) {
  return (
    <div className="bg-surface-container-lowest p-6 rounded-2xl shadow-sm border border-outline-variant/10">
      <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-1">
        {label}
      </p>
      <p className={`text-3xl font-black ${color}`}>{value}</p>
    </div>
  );
}
