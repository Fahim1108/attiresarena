import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import type { OrderStatus, OrderTimelineEvent } from '@/types';
import styles from './OrderTimeline.module.css';

const stages: {status: OrderStatus; label: string}[] = [
  {status:'pending',label:'Order Placed'}, {status:'confirmed',label:'Order Confirmed'},
  {status:'packed',label:'Packed'}, {status:'shipped',label:'Shipped'},
  {status:'out-for-delivery',label:'Out for Delivery'}, {status:'delivered',label:'Delivered'},
];

/** Status and timestamps must come from an authorised order response, never from URL parameters. */
export function OrderTimeline({events,status}: {events:OrderTimelineEvent[];status?:OrderStatus}) {
  const current=status ?? [...events].reverse().find(event=>event.at)?.status;
  const terminal=current==='delivered'||current==='cancelled'||current==='returned';
  const visible=terminal&&current!=='delivered'?[...stages,{status:current,label:current==='cancelled'?'Cancelled':'Returned'}]:stages;
  const currentIndex=current?visible.findIndex((s)=>s.status===current):-1;
  // Client feedback item 18: a stage counts as completed when it was
  // passed. The customer timeline is derived from the current status +
  // placedAt only, so intermediate stages never carry their own
  // timestamp and the old timestamp-only rule left them empty. A
  // cancelled order stopped at an unknown point, so only its
  // timestamped stages (and the cancellation itself) count — the rest
  // are never invented. No timestamp is ever invented: the date line
  // below still renders only when the event has one.
  const isCompleted=(idx:number,stageStatus:OrderStatus,evt?:OrderTimelineEvent)=>{
    if(current!=="cancelled"&&idx<currentIndex)return true;
    if(terminal&&stageStatus===current)return true;
    if(evt?.at&&(stageStatus!==current||terminal))return true;
    return false;
  };
  return <div className={styles.container}><ol className={styles.timeline} aria-label="Order progress">
    {visible.map((stage,index)=>{
      const event=events.find(e=>e.status===stage.status);
      const active=stage.status===current;
      const completed=isCompleted(index,stage.status,event);
      const next=events.find(e=>e.status===visible[index+1]?.status);
      const nextIndex=index+1;
      // The connector after a completed stage reads as travelled when
      // the next stage is completed or is the current one.
      const nextCompleted=nextIndex<visible.length&&isCompleted(nextIndex,visible[nextIndex]!.status,next);
      const nextActive=nextIndex===currentIndex;
      return <li key={stage.status} className={styles.stage} aria-current={active?'step':undefined}>
        {index<visible.length-1&&<span className={cn(styles.line,completed&&(nextCompleted||nextActive)&&styles.completedLine)} aria-hidden />}
        <span data-tracking-indicator className={cn(styles.indicator,(completed||active)&&styles.filled,active&&!terminal&&styles.active)} aria-hidden>{completed&&<Check size={15}/>}</span>
        <div><p className={cn('text-sm font-medium',active?'text-primary':'text-ink')}>{stage.label}</p>
          {active&&<span className="text-xs text-primary">{terminal?'Final status':'Current stage'}</span>}
          {event?.at&&<p className="text-xs text-ink-muted">{formatDateTime(event.at)}</p>}
          {event?.description&&<p className="mt-1 text-xs text-ink-muted">{event.description}</p>}
        </div>
      </li>;
    })}
  </ol></div>;
}
