import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import path from 'path'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { task, sentences, dimension, domain, brand_name } = body

    // Validate required parameters
    if (!task) {
      return NextResponse.json(
        { success: false, error: 'Task parameter is required' },
        { status: 400 }
      )
    }

    if (task === 'generate' && (!sentences || !dimension || !domain || !brand_name)) {
      return NextResponse.json(
        { success: false, error: 'For generate task, sentences, dimension, domain, and brand_name are required' },
        { status: 400 }
      )
    }

    // Path to the inference script
    const inferenceScriptPath = path.join(process.cwd(), 'model_training', 'inference.py')
    
    // Build command arguments
    const args = [
      inferenceScriptPath,
      '--task', task,
    ]

    if (task === 'generate') {
      args.push(
        '--sentences', ...sentences,
        '--dimension', dimension,
        '--domain', domain,
        '--brand_name', brand_name
      )
    }

    console.log('🚀 Running inference with args:', args)

    // Execute the Python script
    const result = await new Promise<{ success: boolean; suggestions?: string; modifiedSentences?: string[]; error?: string }>((resolve, reject) => {
      const pythonProcess = spawn('python3', args, {
        cwd: path.join(process.cwd(), 'model_training'),
        stdio: ['pipe', 'pipe', 'pipe']
      })

      let stdout = ''
      let stderr = ''

      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      pythonProcess.on('close', (code) => {
        console.log('📊 Python process output:', stdout)
        if (stderr) console.error('⚠️ Python process stderr:', stderr)

        if (code !== 0) {
          console.error(`❌ Python process exited with code ${code}`)
          resolve({
            success: false,
            error: `Inference failed with exit code ${code}: ${stderr || 'Unknown error'}`
          })
          return
        }

        try {
          // Parse the output to extract suggestions and modified sentences
          const lines = stdout.split('\n')
          let suggestions = ''
          let modifiedSentences: string[] = []

          // Look for the output patterns from the inference script
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim()
            
            if (line.includes('💡 Modification Suggestions:')) {
              suggestions = line.replace('💡 Modification Suggestions:', '').trim()
            }
            
            if (line.includes('✨ Improved Sentences:')) {
              const sentencesStr = line.replace('✨ Improved Sentences:', '').trim()
              try {
                // Try to parse as JSON array
                const parsed = JSON.parse(sentencesStr)
                if (Array.isArray(parsed)) {
                  modifiedSentences = parsed
                }
              } catch (e) {
                // If not JSON, treat as single sentence
                modifiedSentences = [sentencesStr]
              }
            }
          }

          resolve({
            success: true,
            suggestions: suggestions || 'No suggestions generated',
            modifiedSentences: modifiedSentences.length > 0 ? modifiedSentences : sentences
          })
        } catch (error) {
          console.error('❌ Error parsing inference output:', error)
          resolve({
            success: false,
            error: `Failed to parse inference output: ${error instanceof Error ? error.message : 'Unknown error'}`
          })
        }
      })

      pythonProcess.on('error', (error) => {
        console.error('❌ Failed to start Python process:', error)
        resolve({
          success: false,
          error: `Failed to start inference process: ${error.message}`
        })
      })

      // Set a timeout
      setTimeout(() => {
        pythonProcess.kill()
        resolve({
          success: false,
          error: 'Inference process timed out after 60 seconds'
        })
      }, 60000) // 60 second timeout
    })

    return NextResponse.json(result)

  } catch (error) {
    console.error('❌ Inference API error:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Internal server error' 
      },
      { status: 500 }
    )
  }
}
