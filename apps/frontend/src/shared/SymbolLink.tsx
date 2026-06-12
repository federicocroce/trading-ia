import { useNavigation } from '@/shared/navigation';

interface SymbolLinkProps {
  symbol: string;
  className?: string;
  children?: React.ReactNode;
  /** Para sitios dentro de contenedores clickeables: frena la propagacion. */
  stopPropagation?: boolean;
}

/**
 * Simbolo clickeable → vista de detalle. Conserva la tipografia del sitio que lo usa
 * (className passthrough) y agrega el hover estandar de la app.
 */
export function SymbolLink({ symbol, className = '', children, stopPropagation }: SymbolLinkProps) {
  const { goToSymbol } = useNavigation();
  return (
    <button
      type="button"
      className={`cursor-pointer hover:text-blue-400 transition-colors ${className}`}
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation();
        goToSymbol(symbol);
      }}
      title={`Ver ${symbol}`}
    >
      {children ?? symbol}
    </button>
  );
}
