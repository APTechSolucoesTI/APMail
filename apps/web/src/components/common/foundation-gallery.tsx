import { useState } from 'react';
import { Plus, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandEmpty,
} from '@/components/ui/command';
import { Calendar } from '@/components/ui/calendar';
import { Badge } from '@/components/ui/badge';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { ConfirmDialog } from './confirm-dialog';
import { toast } from 'sonner';
export function FoundationGallery() {
  const [date, setDate] = useState<Date>();
  return (
    <section className="mb-6 rounded-lg border bg-card p-4 shadow-card">
      <h2 className="mb-4 text-2xl font-semibold">Controles e superfícies</h2>
      <Tabs defaultValue="controls">
        <TabsList>
          <TabsTrigger value="controls">Controles</TabsTrigger>
          <TabsTrigger value="panels">Painéis</TabsTrigger>
        </TabsList>
        <TabsContent value="controls">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="demo-name">Nome</Label>
                <Input id="demo-name" placeholder="Informe um nome" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="demo-details">Descrição</Label>
                <Textarea id="demo-details" placeholder="Descreva o contexto" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="demo-priority">Prioridade</Label>
                <Select defaultValue="normal">
                  <SelectTrigger id="demo-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">Alta</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <Checkbox />
                Selecionar opção
              </label>
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <Switch />
                Ativar opção
              </label>
              <RadioGroup defaultValue="comfortable" aria-label="Densidade">
                <label className="flex min-h-11 items-center gap-3 text-sm">
                  <RadioGroupItem value="comfortable" />
                  Confortável
                </label>
                <label className="flex min-h-11 items-center gap-3 text-sm">
                  <RadioGroupItem value="compact" />
                  Compacta
                </label>
              </RadioGroup>
              <ToggleGroup type="single" defaultValue="list" aria-label="Visualização">
                <ToggleGroupItem value="list">Lista</ToggleGroupItem>
                <ToggleGroupItem value="cards">Cards</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div className="space-y-4">
              <div>
                <Label>Data</Label>
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={setDate}
                  className="mt-2 rounded-md border"
                />
              </div>
              <Badge variant="secondary">Metadado</Badge>
              <Separator />
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button variant="outline">Opções avançadas</Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-3 text-sm text-muted-foreground">
                  As opções adicionais aparecem sob demanda.
                </CollapsibleContent>
              </Collapsible>
              <Command className="h-auto rounded-md border">
                <CommandInput placeholder="Buscar opção…" />
                <CommandList>
                  <CommandEmpty>Nenhuma opção encontrada.</CommandEmpty>
                  <CommandItem onSelect={() => toast.info('Opção escolhida.')}>
                    Primeira opção
                  </CommandItem>
                  <CommandItem>Segunda opção</CommandItem>
                </CommandList>
              </Command>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="panels">
          <div className="flex flex-wrap gap-3">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <Plus />
                  Abrir diálogo
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Diálogo de demonstração</DialogTitle>
                  <DialogDescription>
                    O foco permanece dentro desta superfície até ela ser fechada.
                  </DialogDescription>
                </DialogHeader>
              </DialogContent>
            </Dialog>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline">Abrir painel lateral</Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Painel lateral</SheetTitle>
                  <SheetDescription>Opções contextuais e detalhes.</SheetDescription>
                </SheetHeader>
              </SheetContent>
            </Sheet>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline">Abrir popover</Button>
              </PopoverTrigger>
              <PopoverContent>Informação contextual.</PopoverContent>
            </Popover>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <Settings2 />
                  Mais ações
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => toast.info('Ação selecionada.')}>
                  Primeira ação
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <ConfirmDialog
              trigger={<Button variant="outline">Confirmar ação</Button>}
              title="Confirmar alteração?"
              description="Esta é uma demonstração sem dados reais."
              onConfirm={() => toast.success('Ação confirmada.')}
            />
          </div>
          <div className="mt-4 rounded-md border">
            <ResizablePanelGroup orientation="horizontal">
              <ResizablePanel defaultSize="50%">
                <ScrollArea className="h-32">
                  <div className="space-y-3 p-4">
                    {Array.from({ length: 10 }, (_, i) => (
                      <p key={i} className="text-sm">
                        Conteúdo {i + 1}
                      </p>
                    ))}
                  </div>
                </ScrollArea>
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel>
                <p className="p-4 text-sm">
                  Arraste a divisão ou use o teclado para ajustar os painéis.
                </p>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        </TabsContent>
      </Tabs>
    </section>
  );
}
