import type {FMEvent,ShareOptions} from '../src/types';
declare global{
 interface Window{
  /** Populated by the offline export: no network is available in that mode. */
  __HANDOFF_FM_OFFLINE__?:{
   events:FMEvent[];
   options?:Partial<ShareOptions>;
   assets?:Record<string,string>;
  };
 }
}
export {};
