import { useState } from 'react';
import { trpc } from '@/shared/trpc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function PipelineConfig() {
  const utils = trpc.useUtils();
  const { data: discoveryQueries } = trpc.intelligence.configGetDiscoveryQueries.useQuery();
  const { data: thematicQueries } = trpc.intelligence.configGetThematicQueries.useQuery();

  const updateDiscovery = trpc.intelligence.configUpdateDiscoveryQuery.useMutation({
    onSuccess: () => utils.intelligence.configGetDiscoveryQueries.invalidate(),
  });
  const deleteDiscovery = trpc.intelligence.configDeleteDiscoveryQuery.useMutation({
    onSuccess: () => utils.intelligence.configGetDiscoveryQueries.invalidate(),
  });
  const addDiscovery = trpc.intelligence.configAddDiscoveryQuery.useMutation({
    onSuccess: () => utils.intelligence.configGetDiscoveryQueries.invalidate(),
  });

  const updateThematic = trpc.intelligence.configUpdateThematicQuery.useMutation({
    onSuccess: () => utils.intelligence.configGetThematicQueries.invalidate(),
  });
  const deleteThematic = trpc.intelligence.configDeleteThematicQuery.useMutation({
    onSuccess: () => utils.intelligence.configGetThematicQueries.invalidate(),
  });
  const addThematic = trpc.intelligence.configAddThematicQuery.useMutation({
    onSuccess: () => utils.intelligence.configGetThematicQueries.invalidate(),
  });

  const [newDiscoveryQuery, setNewDiscoveryQuery] = useState('');
  const [newDiscoveryLang, setNewDiscoveryLang] = useState<'en' | 'es'>('en');
  const [newThemeName, setNewThemeName] = useState('');
  const [newThemeKeywords, setNewThemeKeywords] = useState('');

  return (
    <div className="space-y-6 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Discovery Queries</CardTitle>
          <p className="text-sm text-muted-foreground">Queries usadas en la búsqueda web (Stage 1)</p>
        </CardHeader>
        <CardContent className="space-y-2">
          {discoveryQueries?.map(q => (
            <div key={q.id} className="flex items-center gap-3 py-1 border-b border-border/40">
              <Switch
                checked={q.active}
                onCheckedChange={active => updateDiscovery.mutate({ id: q.id, active })}
              />
              <span className={`flex-1 text-sm ${!q.active ? 'opacity-40 line-through' : ''}`}>{q.query}</span>
              <Badge variant="outline" className="text-xs">{q.lang}</Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => deleteDiscovery.mutate({ id: q.id })}
                className="text-destructive hover:text-destructive"
              >
                ✕
              </Button>
            </div>
          ))}
          <div className="flex gap-2 mt-3">
            <Input
              placeholder="Nueva query de búsqueda..."
              value={newDiscoveryQuery}
              onChange={e => setNewDiscoveryQuery(e.target.value)}
              className="flex-1"
            />
            <select
              value={newDiscoveryLang}
              onChange={e => setNewDiscoveryLang(e.target.value as 'en' | 'es')}
              className="border rounded px-2 text-sm bg-background"
            >
              <option value="en">EN</option>
              <option value="es">ES</option>
            </select>
            <Button
              size="sm"
              disabled={addDiscovery.isPending}
              onClick={() => {
                if (newDiscoveryQuery.trim()) {
                  addDiscovery.mutate({ query: newDiscoveryQuery.trim(), lang: newDiscoveryLang });
                  setNewDiscoveryQuery('');
                }
              }}
            >
              + Agregar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Temas del Market Report</CardTitle>
          <p className="text-sm text-muted-foreground">Temas usados en el análisis temático (Stage 5)</p>
        </CardHeader>
        <CardContent className="space-y-2">
          {thematicQueries?.map(q => (
            <div key={q.id} className="flex items-center gap-3 py-1 border-b border-border/40">
              <Switch
                checked={q.active}
                onCheckedChange={active => updateThematic.mutate({ id: q.id, active })}
              />
              <div className="flex-1">
                <div className={`text-sm font-medium ${!q.active ? 'opacity-40 line-through' : ''}`}>{q.name}</div>
                <div className="text-xs text-muted-foreground">{q.keywords.slice(0, 4).join(', ')}{q.keywords.length > 4 ? '...' : ''}</div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => deleteThematic.mutate({ id: q.id })}
                className="text-destructive hover:text-destructive"
              >
                ✕
              </Button>
            </div>
          ))}
          <div className="flex gap-2 mt-3">
            <Input
              placeholder="Nombre del tema..."
              value={newThemeName}
              onChange={e => setNewThemeName(e.target.value)}
              className="w-40"
            />
            <Input
              placeholder="Keywords separadas por coma..."
              value={newThemeKeywords}
              onChange={e => setNewThemeKeywords(e.target.value)}
              className="flex-1"
            />
            <Button
              size="sm"
              disabled={addThematic.isPending}
              onClick={() => {
                if (newThemeName.trim() && newThemeKeywords.trim()) {
                  addThematic.mutate({
                    name: newThemeName.trim(),
                    keywords: newThemeKeywords.split(',').map(k => k.trim()).filter(Boolean),
                  });
                  setNewThemeName('');
                  setNewThemeKeywords('');
                }
              }}
            >
              + Agregar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
