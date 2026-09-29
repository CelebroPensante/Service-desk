import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";

interface AuthSubmitButtonProps {
  children: ReactNode;
  loading?: boolean;
  loadingLabel: string;
}

export default function AuthSubmitButton({
  children,
  loading = false,
  loadingLabel,
}: AuthSubmitButtonProps) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full rounded-lg py-2.5 text-sm font-medium text-white bg-gradient-to-r from-blue-900 to-blue-600 hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-2"
    >
      {loading ? loadingLabel : children}
      {!loading && <ArrowRight size={16} />}
    </button>
  );
}