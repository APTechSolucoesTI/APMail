import {useState} from 'react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {render,screen,fireEvent} from '@testing-library/react';
import {expect,it} from 'vitest';
import type {Address} from '@apmail/shared';
import {EmailChipInput} from './email-chip-input';
function Fixture(){const [value,setValue]=useState<Address[]>([]);return <QueryClientProvider client={new QueryClient()}><EmailChipInput label="Para" value={value} onChange={setValue} mailboxId="fixture"/></QueryClientProvider>;}
it('cola destinatários sem duplicar, sinaliza inválidos e permite remoção pelo teclado',()=>{
 render(<Fixture/>);const input=screen.getByRole('combobox',{name:'Para'});
 fireEvent.paste(input,{clipboardData:{getData:()=> 'Maria <MARIA@exemplo.com>; maria@exemplo.com\ninválido'}});
 expect(screen.getAllByRole('button',{name:'Remover maria@exemplo.com'})).toHaveLength(1);
 expect(screen.getByText('inválido (inválido)')).toBeVisible();fireEvent.keyDown(input,{key:'Backspace'});expect(screen.queryByText('inválido (inválido)')).not.toBeInTheDocument();
 fireEvent.change(input,{target:{value:'joao@exemplo.com'}});fireEvent.keyDown(input,{key:'Enter'});expect(screen.getByRole('button',{name:'Remover joao@exemplo.com'})).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Remover maria@exemplo.com'}));expect(screen.queryByRole('button',{name:'Remover maria@exemplo.com'})).not.toBeInTheDocument();
});
