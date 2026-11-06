import { Link } from '@tanstack/react-router'
import { ArrowUpRight, Check, Cloud, Download, Laptop, LockKeyhole, Minus, Pause } from 'lucide-react'

import { translations, type Language } from '../i18n'
import { homepagePricing } from '../pricing'

function PriceAmount({ amount, compact = false }: { amount: number; compact?: boolean }) {
  return <span className={`inline-flex items-baseline whitespace-nowrap leading-none ${compact ? 'gap-0.5 text-[22px] max-sm:text-xl' : 'gap-1 text-[56px] max-sm:text-[38px]'}`}>
    <span className={`relative font-currency font-normal text-muted ${compact ? '-top-[.25em] text-[.6em]' : '-top-[.75em] text-[.36em]'}`}>฿</span>
    <span className="font-price font-normal tracking-[-.035em] tabular-nums text-ink">{amount}</span>
  </span>
}

export function FeatureComparison({ language }: { language: Language }) {
  const t = translations[language].comparison
  const groups = [
    { title: t.localGroup, features: t.localFeatures, cloudOnly: false },
    { title: t.cloudGroup, features: t.cloudFeatures, cloudOnly: true },
  ]

  const availability = (included: boolean) => <span className="inline-flex align-middle">
    {included
      ? <Check className="size-6 rounded-full bg-emerald-600/10 p-1 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300" strokeWidth={2.5} aria-hidden="true" />
      : <Minus className="size-5 text-muted/60" aria-hidden="true" />}
    <span className="sr-only">{included ? t.included : t.notIncluded}</span>
  </span>

  return <section id="compare" aria-labelledby="comparison-heading" className="relative mx-auto w-full max-w-[1080px] scroll-mt-8 px-6 pt-16 pb-20 sm:pt-20 sm:pb-24 max-sm:px-4">
    <div className="mx-auto mb-10 max-w-2xl text-center sm:mb-12">
      <p data-reveal className="scroll-reveal text-[10px] font-semibold tracking-[2px] text-brand dark:text-[#b58bff] thai:text-xs thai:tracking-normal">{t.eyebrow}</p>
      <h2 id="comparison-heading" data-reveal className="scroll-reveal mt-4 text-3xl leading-tight font-[650] tracking-[-1px] [--reveal-delay:60ms] sm:text-[42px] thai:tracking-normal thai:leading-[1.4]">{t.title}</h2>
      <p data-reveal className="scroll-reveal mx-auto mt-4 max-w-xl text-sm leading-7 text-muted [--reveal-delay:120ms] sm:text-base">{t.description}</p>
    </div>

    <div data-reveal className="scroll-reveal overflow-hidden rounded-2xl border border-line bg-card [--reveal-delay:80ms] sm:rounded-3xl">
      <table className="w-full table-fixed border-collapse text-left text-sm max-sm:text-xs">
        <caption className="sr-only">{t.caption}</caption>
        <colgroup><col className="w-[44%] sm:w-[46%]" /><col className="w-[28%] sm:w-[27%]" /><col className="w-[28%] bg-brand/[.045] sm:w-[27%] dark:bg-brand/[.08]" /></colgroup>
        <thead>
          <tr>
            <th scope="col" className="px-6 py-7 align-bottom font-medium text-muted sm:px-8 max-sm:px-3 max-sm:py-5">{t.feature}</th>
            <th scope="col" className="px-4 py-7 text-center align-top font-normal max-sm:px-2 max-sm:py-5">
              <Laptop className="mx-auto mb-4 size-6 text-muted max-sm:size-5" aria-hidden="true" />
              <span className="block text-xl leading-snug font-semibold tracking-[-.5px] max-sm:min-h-10 max-sm:text-sm thai:tracking-normal">{t.freeName}</span>
              <span className="mx-auto mt-2 block min-h-10 max-w-44 text-xs leading-5 text-muted max-sm:hidden">{t.freeDescription}</span>
              <span className="mt-6 block"><PriceAmount amount={0} /></span>
              <span className="mt-2 block text-xs leading-5 text-muted max-sm:text-[11px]">{t.freePriceNote}</span>
              <span className="mt-4 block text-[11px] leading-5 font-medium">{t.freeLabel}</span>
            </th>
            <th scope="col" className="px-4 py-7 text-center align-top font-normal max-sm:px-2 max-sm:py-5">
              <Cloud className="mx-auto mb-4 size-6 text-brand dark:text-[#b58bff] max-sm:size-5" aria-hidden="true" />
              <span className="block text-xl leading-snug font-semibold tracking-[-.5px] max-sm:min-h-10 max-sm:text-sm thai:tracking-normal">{t.accountName}</span>
              <span className="mx-auto mt-2 block min-h-10 max-w-44 text-xs leading-5 text-muted max-sm:hidden">{t.accountDescription}</span>
              <span className="mt-6 flex flex-wrap items-baseline justify-center gap-x-2 gap-y-1">
                <PriceAmount amount={homepagePricing.monthlyTHB} />{' '}
                <span className="whitespace-nowrap text-xs leading-5 text-muted max-sm:text-[11px]">{t.monthly}</span>
              </span>
              <span className="mt-3 flex flex-wrap items-baseline justify-center gap-x-1 gap-y-1 text-xs leading-5 text-muted max-sm:text-[11px]">
                <span>{t.or}</span>{' '}<PriceAmount amount={homepagePricing.yearlyTHB} compact />{' '}<span className="whitespace-nowrap">{t.yearly}</span>
              </span>
              <span className="mt-4 block text-[11px] leading-5 font-medium text-brand dark:text-[#b58bff]">{t.accountLabel}</span>
            </th>
          </tr>
        </thead>
        {groups.map(group => <tbody key={group.title}>
          <tr><th colSpan={3} scope="rowgroup" className="border-y border-line bg-page/80 px-6 py-3 text-[11px] font-semibold text-muted sm:px-8 max-sm:px-3 thai:text-xs">{group.title}</th></tr>
          {group.features.map(feature => <tr key={feature} className="border-b border-line last:border-b-0">
            <th scope="row" className="px-6 py-4 leading-6 font-normal sm:px-8 max-sm:px-3 max-sm:leading-5">{feature}</th>
            <td className="px-2 py-4 text-center">{availability(!group.cloudOnly)}</td>
            <td className="px-2 py-4 text-center">{availability(true)}</td>
          </tr>)}
        </tbody>)}
        <tfoot>
          <tr className="border-t border-line">
            <td className="px-6 py-6 sm:px-8 max-sm:px-3" />
            <td className="px-4 py-6 text-center max-sm:px-2">
              <a href="#download" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line bg-page px-4 py-3 text-xs font-semibold transition-colors hover:border-brand hover:text-brand max-sm:px-2 max-sm:text-[11px]">
                {t.download}<Download className="size-3.5 shrink-0 max-sm:hidden" aria-hidden="true" />
              </a>
            </td>
            <td className="px-4 py-6 text-center max-sm:px-2">
              <Link to="/account" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3 text-xs font-semibold text-white transition-colors hover:bg-brand/85 max-sm:px-2 max-sm:text-[11px]">
                {t.account}<ArrowUpRight className="size-3.5 shrink-0 max-sm:hidden" aria-hidden="true" />
              </Link>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
    <p data-reveal className="scroll-reveal mx-auto mt-5 max-w-2xl text-center text-xs leading-6 text-muted">{t.subscriptionNote}</p>

    <div className="mt-10 grid gap-7 border-t border-line pt-8 sm:grid-cols-2 sm:gap-12">
      {[{ Icon: LockKeyhole, title: t.privacyTitle, description: t.privacyDescription }, { Icon: Pause, title: t.accessTitle, description: t.accessDescription }].map(({ Icon, title, description }, index) => <div key={title} data-reveal className={`scroll-reveal flex items-start gap-3 ${index === 1 ? '[--reveal-delay:100ms]' : ''}`}>
        <Icon className="mt-0.5 size-4 shrink-0 text-brand dark:text-[#b58bff]" aria-hidden="true" />
        <div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-2 text-xs leading-6 text-muted">{description}</p></div>
      </div>)}
    </div>
  </section>
}
