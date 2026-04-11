import { useChatCollapsed } from '@/hooks/useChatCollapsed';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface ChatToggleProps {
  children: React.ReactNode;
}

export function ChatToggle({ children }: ChatToggleProps) {
  const { collapsed, toggle } = useChatCollapsed();

  return (
    <div className="flex h-full relative">
      {/* Toggle button on left edge */}
      <div className="flex items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggle}
              className="flex items-center justify-center w-5 h-14 bg-card border-l border-t border-b border-border rounded-l-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              aria-label={collapsed ? 'Abrir chat' : 'Cerrar chat'}
            >
              {collapsed
                ? <ChevronLeft className="w-3 h-3" />
                : <ChevronRight className="w-3 h-3" />
              }
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">
            {collapsed ? 'Abrir chat Claude' : 'Cerrar chat'}
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Chat panel with collapse animation */}
      <div
        className="overflow-hidden transition-all duration-200 ease-in-out"
        style={{ width: collapsed ? 0 : 384 }}
        aria-hidden={collapsed}
      >
        {children}
      </div>
    </div>
  );
}
