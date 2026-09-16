import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Capabilities } from '../src/shared/types.js';
import type { SurfaceRegistrar } from '../src/main/mcp/kernel.js';
import { z } from 'zod';

const state = vi.hoisted(() => ({
  caps: {screen:true,control:true}, unattributed:true,
  caller: null as null | {sessionId:string;conversationId:string},
  inputs: [] as Array<Record<string, unknown>>,
  attachment:'current', blocked:false, execute:vi.fn(), image:vi.fn(async()=> 'image/jpeg')
}));
vi.mock('../src/main/config.js',()=>({getConfig:()=>({multiAgent:{allowUnattributedCalls:state.unattributed}}),effectiveCapabilities:()=>state.caps}));
vi.mock('../src/main/mcp/call-context.js',()=>({currentCall:()=>({caller:state.caller})}));
vi.mock('../src/main/mcp/kernel.js',()=>({fail:(text:string)=>({isError:true,content:[{type:'text',text}]}),failIdentity:(text:string)=>({isError:true,content:[{type:'text',text}]})}));
vi.mock('../src/main/browser-control.js',()=>({browserControl:{execute:state.execute}}));
vi.mock('../src/main/session/input.js',()=>({listInputs:async()=>state.inputs}));
vi.mock('../src/main/session/store.js',()=>({conversationAttachment:async()=>state.attachment}));
vi.mock('../src/main/session/blocked-chats.js',()=>({isChatBlocked:()=>state.blocked}));
vi.mock('../src/main/session/continuation.js',()=>({compactingConversation:()=>false}));
vi.mock('../src/main/agents.js',()=>({dormantWorkerNotice:()=>null,endedWorkerNotice:()=>null,retiredWorkerForConversation:()=>null}));
vi.mock('../src/main/codex/view-image.js',()=>({validateImageBytes:state.image}));
import { registerBrowserTools } from '../src/main/mcp/tools-browser.js';
import {
  directorSecurityJournal,
  noteDirectorInstruction,
  resetDirectorAuthorityForTests
} from '../src/main/security/director-authority.js';

function registrar() {
  const tools = new Map<string,{schema:z.ZodType;annotations:Record<string,unknown>;handler:(input:unknown)=>Promise<any>}>();
  registerBrowserTools({exposedCaps:{screen:true,control:true} as Capabilities,
    register:(name:string,definition:any,handler:any)=>{tools.set(name,{schema:definition.inputSchema,annotations:definition.annotations,handler});},
    guarded:async(cap:'screen'|'control',_name:string,fn:()=>Promise<unknown>)=>state.caps[cap]?fn():{isError:true,content:[{type:'text',text:'TOOL_DISABLED'}]}
  } as unknown as SurfaceRegistrar);
  return {tools,call:(name:string,input:unknown)=>{const tool=tools.get(name)!;return tool.handler(tool.schema.parse(input));}};
}
const tabId='11111111-1111-4111-8111-111111111111:12';
const pageId='22222222-2222-4222-8222-222222222222';
beforeEach(()=>{
  resetDirectorAuthorityForTests();
  state.caps={screen:true,control:true};state.unattributed=true;state.caller=null;state.inputs=[];state.attachment='current';state.blocked=false;
  state.execute.mockReset().mockResolvedValue({value:{ok:true}});state.image.mockClear();
});

describe('Desktop browser invocation boundary',()=>{
  it('applies live input policy to new/close even though tabs also has read operations',async()=>{
    const reg=registrar();state.caps.control=false;
    expect((await reg.call('browser_tabs',{action:'list'})).isError).not.toBe(true);
    expect((await reg.call('browser_tabs',{action:'new'})).isError).toBe(true);
    expect((await reg.call('browser_tabs',{action:'close',tabId})).isError).toBe(true);
    expect(state.execute).toHaveBeenCalledTimes(1);
    expect(reg.tools.get('browser_tabs')!.annotations.idempotentHint).toBe(false);
  });
  it('keeps unattributed permission explicit and checks it again at dispatch for observation',async()=>{
    const reg=registrar();state.unattributed=false;
    expect((await reg.call('browser_tabs',{action:'list'})).content[0].text).toContain('IDENTITY_REQUIRED');
    expect(state.execute).not.toHaveBeenCalled();state.unattributed=true;
    await reg.call('browser_tabs',{action:'list'});
    const call=state.execute.mock.calls[0]!;expect(call[2]).toBe('unattributed');
    expect(await call[4]()).toBe(true);state.unattributed=false;expect(await call[4]()).toBe(false);
  });
  it('never lets Allow unattributed calls authorize a browser mutation',async()=>{
    const reg=registrar();state.unattributed=true;
    const blocked=await reg.call('browser_tabs',{action:'new',url:'https://example.com'});
    expect(blocked.isError).toBe(true);
    expect(blocked.content[0].text).toContain('DIRECTOR_AUTHORITY_REQUIRED');
    expect(blocked.content[0].text).toContain('observation only');
    expect(state.execute).not.toHaveBeenCalled();

    state.caller={sessionId:'session-a',conversationId:'chat-a'};
    const allowed=await reg.call('browser_tabs',{action:'new',url:'https://example.com'});
    expect(allowed.isError).not.toBe(true);
    expect(state.execute).toHaveBeenCalledOnce();
    expect(state.execute.mock.calls[0]!.slice(2,4)).toEqual(['session:session-a','chat-a']);
  });
  it('requires exact receipt, then fresh Director instruction after external observation before page action',async()=>{
    const reg=registrar();state.caller={sessionId:'session-a',conversationId:'chat-a'};
    const action={tabId,pageId,action:'key',key:'Enter'};

    const withoutDirector=await reg.call('browser_action',action);
    expect(withoutDirector.isError).toBe(true);
    expect(withoutDirector.content[0].text).toContain('DIRECTOR_AUTHORITY_REQUIRED');
    expect(state.execute).not.toHaveBeenCalled();

    noteDirectorInstruction('session-a','input-1',100);
    const pending=await reg.call('browser_action',action);
    expect(pending.isError).toBe(true);
    expect(pending.content[0].text).toContain('DIRECTOR_DELIVERY_PENDING');
    expect(state.execute).not.toHaveBeenCalled();

    state.inputs=[{id:'input-1',sessionId:'session-a',state:'sent',deliveredAt:110,purpose:'user'}];
    await reg.call('browser_snapshot',{tabId});
    expect(state.execute).toHaveBeenCalledOnce();

    const afterObservation=await reg.call('browser_action',action);
    expect(afterObservation.isError).toBe(true);
    expect(afterObservation.content[0].text).toContain('DIRECTOR_REAUTHORIZATION_REQUIRED');
    expect(state.execute).toHaveBeenCalledOnce();
    expect(directorSecurityJournal()).toMatchObject([
      {sessionId:'session-a',tool:'browser_action',reason:'director_instruction_pending_delivery'},
      {sessionId:'session-a',tool:'browser_action',reason:'untrusted_external_content'}
    ]);

    noteDirectorInstruction('session-a','input-2',200);
    const replacementPending=await reg.call('browser_action',action);
    expect(replacementPending.isError).toBe(true);
    expect(replacementPending.content[0].text).toContain('DIRECTOR_DELIVERY_PENDING');
    expect(state.execute).toHaveBeenCalledOnce();

    state.inputs.push({id:'input-2',sessionId:'session-a',state:'sent',deliveredAt:210,purpose:'user'});
    const authorized=await reg.call('browser_action',action);
    expect(authorized.isError).not.toBe(true);
    expect(state.execute).toHaveBeenCalledTimes(2);
  });
  it('retains exact session ownership and refuses superseded or blocked caller execution',async()=>{
    state.caller={sessionId:'session-a',conversationId:'chat-a'};
    await registrar().call('browser_tabs',{action:'attach',tabId});
    const call=state.execute.mock.calls[0]!;expect(call.slice(2,4)).toEqual(['session:session-a','chat-a']);
    expect(await call[4]()).toBe(true);state.attachment='superseded';expect(await call[4]()).toBe(false);
    state.attachment='current';state.blocked=true;expect(await call[4]()).toBe(false);
  });
  it('validates action targets and required values before admitting a command',()=>{
    const schema=registrar().tools.get('browser_action')!.schema;
    expect(schema.safeParse({tabId,pageId,action:'click',x:20,y:20}).success).toBe(false);
    expect(schema.safeParse({tabId,pageId,action:'fill',ref:'r'}).success).toBe(false);
    expect(schema.safeParse({tabId,pageId,action:'fill',ref:'r',text:''}).success).toBe(true);
    expect(schema.safeParse({tabId,pageId,action:'click',x:20,y:20,screenshotId:'s'}).success).toBe(true);
    const confused=schema.safeParse({tabId,pageId:`${pageId}:frame`,action:'key',key:'ENTER'});
    expect(confused.success).toBe(false);
    if (!confused.success) expect(confused.error.issues[0]?.message).toContain('top-level pageId');
    expect(schema.safeParse({tabId,pageId,action:'key',key:'w',holdMs:300}).success).toBe(true);
    expect(schema.safeParse({tabId,pageId,action:'key',key:'w',holdMs:2001}).success).toBe(false);
    expect(schema.safeParse({tabId,pageId,action:'click',ref:'r',holdMs:300}).success).toBe(false);
  });
  it('returns screenshots once as native image blocks after invoking the pixel validator',async()=>{
    const data=Buffer.from('fixture bytes').toString('base64');
    state.execute.mockResolvedValue({value:{width:2,height:2},image:{mimeType:'image/jpeg',data}});
    const result=await registrar().call('browser_screenshot',{tabId});
    expect(result.content).toEqual([{type:'text',text:'{"width":2,"height":2}'},{type:'image',mimeType:'image/jpeg',data}]);
    expect(JSON.stringify(result.structuredContent)).not.toContain(data);
    expect(state.image).toHaveBeenCalledWith(Buffer.from('fixture bytes'));
  });
});
