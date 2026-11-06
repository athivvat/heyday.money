import type { SendCode } from './options'
import { emailDeliveryFailed } from './delivery'

export interface EmailSender {
  emails: { send(input: { from: string; to: string; subject: string; text: string }): Promise<{ error: unknown }> }
}

export function sendAuthCode(sender: EmailSender, from: string): SendCode {
  return async ({ email, otp, type }) => {
    const purpose = type === 'sign-in' ? 'sign in to Heyday Money' : 'verify your Heyday Money email'
    try {
      const { error } = await sender.emails.send({
        from, to: email, subject: 'Your Heyday Money verification code',
        text: `Your code to ${purpose} is ${otp}.\n\nIt expires in 5 minutes. If you did not request this code, you can ignore this email.\n\nThis code does not recover or unlock your encrypted cloud data.`,
      })
      if (error) throw error
    } catch (error) {
      emailDeliveryFailed(error)
      throw new Error('Unable to deliver verification email.')
    }
  }
}
