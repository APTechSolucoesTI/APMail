import {render,screen,fireEvent} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {EmailBodyFrame} from './email-body-frame';
it('bloqueia imagens remotas até consentimento e isola scripts e formulários',()=>{
 vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});
 const {unmount}=render(<EmailBodyFrame html={'<p>Mensagem</p><img data-apmail-src="https://tracker.example/image"><img data-apmail-cid="logo"><script>alert(1)</script><form><input></form><a href="https://example.com">Link</a>'} cidMap={{logo:'attachment-id'}}/>);
 const frame=screen.getByTitle('Conteúdo do e-mail');let doc=new DOMParser().parseFromString(frame.getAttribute('srcdoc')!,'text/html');
 expect(doc.querySelector('script,form,input')).toBeNull();expect(doc.querySelector('img')?.hasAttribute('src')).toBe(false);expect(doc.querySelectorAll('img')[1]?.getAttribute('src')).toBe('/api/attachments/attachment-id/inline');expect(doc.querySelector('a')?.getAttribute('rel')).toContain('noopener');expect(frame.getAttribute('sandbox')).not.toContain('allow-scripts');
 fireEvent.click(screen.getByRole('button',{name:'Exibir imagens'}));doc=new DOMParser().parseFromString(frame.getAttribute('srcdoc')!,'text/html');expect(doc.querySelector('img')?.getAttribute('src')).toBe('https://tracker.example/image');
 unmount();vi.unstubAllGlobals();
});
