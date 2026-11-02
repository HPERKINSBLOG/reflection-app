import type { ComponentPropsWithRef, ReactNode } from 'react';
import paperMark from './art/return-mark-paper.svg';
import eveningMark from './art/return-mark-evening.svg';

function classes(...values: (string | undefined | false)[]) {
  return values.filter(Boolean).join(' ');
}

export function Button({
  variant = 'primary',
  className,
  type = 'button',
  ...props
}: ComponentPropsWithRef<'button'> & {
  variant?: 'primary' | 'secondary' | 'text-button' | 'danger';
}) {
  return (
    <button
      type={type}
      className={classes('ui-button', variant !== 'primary' && variant, className)}
      {...props}
    />
  );
}

export function TextLink({ className, ...props }: ComponentPropsWithRef<'a'>) {
  return <a className={classes('text-link', className)} {...props} />;
}

export function Input({ className, ...props }: ComponentPropsWithRef<'input'>) {
  return <input className={classes('ui-input', className)} {...props} />;
}

export function TextArea({ className, ...props }: ComponentPropsWithRef<'textarea'>) {
  return <textarea className={classes('ui-textarea', className)} {...props} />;
}

export function ReflectionField({
  label,
  hint,
  id,
  ...props
}: ComponentPropsWithRef<'textarea'> & { id: string; label: ReactNode; hint?: ReactNode }) {
  const describedBy = [props['aria-describedby'], hint ? `${id}-help` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="reflection-field">
      <label htmlFor={id}>{label}</label>
      <TextArea {...props} id={id} aria-describedby={describedBy || undefined} />
      {hint && (
        <p id={`${id}-help`} className="field-hint">
          {hint}
        </p>
      )}
    </div>
  );
}

export function TopicChip({
  tone = 'mint',
  className,
  ...props
}: ComponentPropsWithRef<'span'> & { tone?: 'mint' | 'butter' | 'sage' | 'coral' }) {
  return <span className={classes('topic-chip', `tone-${tone}`, className)} {...props} />;
}

export function ReflectionCard({ className, ...props }: ComponentPropsWithRef<'section'>) {
  return <section className={classes('card', 'reflection-card', className)} {...props} />;
}

export function Brand() {
  return (
    <a className="brand" href="/">
      <span className="brand-mark" aria-hidden="true">
        <img className="paper-mark" src={paperMark} alt="" width="30" height="30" />
        <img className="evening-mark" src={eveningMark} alt="" width="30" height="30" />
      </span>
      Reflection
    </a>
  );
}
