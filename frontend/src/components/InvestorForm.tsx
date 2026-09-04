import { ShieldCheck, UserRound } from 'lucide-react'
import type { RiskProfile } from '../types'
import { Card, Field, SectionHeader, inputClass, inputErrorClass } from './ui'

const PROFILES: { value: RiskProfile; blurb: string }[] = [
  { value: 'Conservative', blurb: 'Prioritises capital preservation' },
  { value: 'Balanced', blurb: 'Mix of growth and stability' },
  { value: 'Aggressive', blurb: 'Accepts higher volatility for growth' },
]

interface Props {
  age: string
  riskProfile: RiskProfile
  ageError?: string
  onAgeChange: (age: string) => void
  onRiskProfileChange: (profile: RiskProfile) => void
}

export function InvestorForm({
  age,
  riskProfile,
  ageError,
  onAgeChange,
  onRiskProfileChange,
}: Props) {
  const selected = PROFILES.find((p) => p.value === riskProfile)

  return (
    <Card>
      <SectionHeader
        icon={<UserRound className="size-4.5" aria-hidden="true" />}
        title="Investor profile"
        description="Recorded for context in the report. It never drives a buy, sell or switch recommendation."
      />
      <div className="grid gap-5 px-5 py-5 sm:grid-cols-2 sm:px-7">
        <Field
          label="Age"
          htmlFor="investor-age"
          error={ageError}
          hint="Between 18 and 100."
        >
          <input
            id="investor-age"
            type="number"
            inputMode="numeric"
            min={18}
            max={100}
            step={1}
            placeholder="34"
            value={age}
            onChange={(event) => onAgeChange(event.target.value)}
            className={`${inputClass} ${ageError ? inputErrorClass : ''}`}
          />
        </Field>

        <Field
          label="Risk profile"
          htmlFor="risk-profile"
          hint={selected?.blurb}
        >
          <div className="relative">
            <ShieldCheck
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400"
              aria-hidden="true"
            />
            <select
              id="risk-profile"
              value={riskProfile}
              onChange={(event) => onRiskProfileChange(event.target.value as RiskProfile)}
              className={`${inputClass} appearance-none pl-9`}
            >
              {PROFILES.map((profile) => (
                <option key={profile.value} value={profile.value}>
                  {profile.value}
                </option>
              ))}
            </select>
          </div>
        </Field>
      </div>
    </Card>
  )
}
