import {expect, test} from '@jest/globals'
import {
  createCommentIfFromCopilotDefender,
  getChatGPTResponse
} from '../src/create-comment'

require('dotenv').config()

// test('replies to only copilot defender', async () => {
//   expect(1).toBe(1)
//   const commentId = '1223278803'
//   expect(commentId).not.toBeUndefined()

//   await createCommentIfFromCopilotDefender(parseInt(commentId))
// })

test('get chatgpt response', async () => {
  const promptMessages = [
    {
      role: 'system',
      content: "Follow the user's instructions"
    },
    {
      role: 'user',
      content: 'I say 1, you say 2. Ready?\n\n1!'
    }
  ]
  const response = await getChatGPTResponse(promptMessages)
  expect(response).not.toBeUndefined()
  expect(response).toBe('2!')
})
