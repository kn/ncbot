import ethers from 'ethers'
import canonicalize from 'canonicalize'
import fetch from 'node-fetch'
import * as dotenv from 'dotenv'
dotenv.config()

async function run() {
  if (!process.env.FARCASTER_SEED_PHRASE) {
    console.log('NO SEED PHRASE')
    return
  }

  const wallet = ethers.Wallet.fromMnemonic(process.env.FARCASTER_SEED_PHRASE)

  const currentTimestamp = Date.now() // get the current timestamp

  const payload = canonicalize({
    method: 'generateToken',
    params: {
      timestamp: currentTimestamp,
    },
  })

  const signedPayload = await wallet.signMessage(payload)

  const signature = Buffer.from(ethers.utils.arrayify(signedPayload)).toString(
    'base64'
  )

  const bearerToken = `eip191:${signature}`

  const response = await fetch('https://api.farcaster.xyz/v2/auth', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearerToken}`,
    },
    body: payload,
  })
  const data = await response.json()
  console.log('BEARER TOKEN: ', data.result.token.secret)
}

run()
