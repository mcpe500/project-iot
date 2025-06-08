import { GoogleGenerativeAI, Part } from '@google/generative-ai';
import type { 
  GeminiRequest, 
  GeminiResponse, 
  GeminiAnalysisResult, 
  GeminiFileUpload,
  SupportedMimeType 
} from '@/types';
import { generateId } from '@/utils/helpers';

export class GeminiService {
  private genAI: GoogleGenerativeAI | null = null;
  private model: any = null;
  private readonly supportedFormats: Set<string>;
  private readonly maxFileSize: number;

  constructor() {
    this.supportedFormats = new Set(
      (process.env.GEMINI_SUPPORTED_FORMATS || '').split(',').map(f => f.trim())
    );
    this.maxFileSize = this.parseFileSize(process.env.GEMINI_MAX_FILE_SIZE || '50MB');
    
    if (process.env.GEMINI_API_KEY) {
      this.initialize();
    }
  }

  private initialize(): void {
    try {
      this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
      this.model = this.genAI.getGenerativeModel({ 
        model: process.env.GEMINI_MODEL || 'gemini-1.5-pro-latest' 
      });
    } catch (error) {
      console.error('Failed to initialize Gemini AI:', error);
    }
  }

  private parseFileSize(sizeStr: string): number {
    const units = { B: 1, KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024 };
    const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)$/i);
    if (!match) return 50 * 1024 * 1024; // Default 50MB
    
    const [, size, unit] = match;
    return parseFloat(size) * (units[unit.toUpperCase() as keyof typeof units] || 1);
  }

  public isAvailable(): boolean {
    return this.genAI !== null && this.model !== null;
  }

  public validateFile(file: GeminiFileUpload): { valid: boolean; error?: string } {
    if (!this.supportedFormats.has(file.mimetype)) {
      return {
        valid: false,
        error: `Unsupported file type: ${file.mimetype}. Supported: ${Array.from(this.supportedFormats).join(', ')}`
      };
    }

    if (file.size > this.maxFileSize) {
      return {
        valid: false,
        error: `File too large: ${file.size} bytes. Maximum: ${this.maxFileSize} bytes`
      };
    }

    return { valid: true };
  }

  private async convertFileToGenerativePart(file: GeminiFileUpload): Promise<Part> {
    return {
      inlineData: {
        data: file.buffer.toString('base64'),
        mimeType: file.mimetype as SupportedMimeType
      }
    };
  }

  public async generateResponse(request: GeminiRequest): Promise<GeminiResponse> {
    if (!this.isAvailable()) {
      throw new Error('Gemini AI service is not available. Please check your API key configuration.');
    }

    const startTime = Date.now();
    const requestId = generateId('gemini');

    try {
      // Prepare the parts for the request
      const parts: Part[] = [];

      // Add the text prompt
      parts.push({ text: request.prompt });

      // Add context if provided
      if (request.context) {
        parts.push({ text: `Context: ${request.context}` });
      }

      // Process files if provided
      if (request.files && request.files.length > 0) {
        for (const file of request.files) {
          const validation = this.validateFile(file);
          if (!validation.valid) {
            throw new Error(validation.error);
          }

          const part = await this.convertFileToGenerativePart(file);
          parts.push(part);
        }
      }

      // Generate content
      const result = await this.model.generateContent(parts);
      const response = await result.response;
      const text = response.text();

      const processingTime = Date.now() - startTime;

      return {
        id: requestId,
        response: text,
        usage: {
          promptTokens: 0, // Gemini doesn't provide token counts in the same way
          completionTokens: 0,
          totalTokens: 0
        },
        processingTime,
        model: process.env.GEMINI_MODEL || 'gemini-1.5-pro-latest',
        timestamp: Date.now()
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      throw new Error(`Gemini API error (${processingTime}ms): ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  public async analyzeContent(request: GeminiRequest): Promise<GeminiAnalysisResult> {
    // Enhanced prompt for analysis
    const analysisPrompt = `
Please analyze the provided content and respond with a structured analysis in the following JSON format:

{
  "analysis": "Overall analysis of the content",
  "insights": ["Key insight 1", "Key insight 2", "..."],
  "recommendations": ["Recommendation 1", "Recommendation 2", "..."],
  "confidence": 0.85,
  "fileAnalysis": {
    "filename.jpg": {
      "type": "image",
      "description": "Description of what's in the image",
      "features": ["feature1", "feature2"]
    }
  }
}

Original prompt: ${request.prompt}
`;

    const analysisRequest: GeminiRequest = {
      ...request,
      prompt: analysisPrompt
    };

    const response = await this.generateResponse(analysisRequest);

    try {
      // Try to parse the response as JSON
      const parsed = JSON.parse(response.response);
      return parsed as GeminiAnalysisResult;
    } catch (error) {
      // If parsing fails, create a structured response from the text
      return {
        analysis: response.response,
        insights: [],
        recommendations: [],
        confidence: 0.7,
        fileAnalysis: {}
      };
    }
  }

  public async analyzeIoTData(
    sensorData: any, 
    files: GeminiFileUpload[] = [],
    customPrompt?: string
  ): Promise<GeminiAnalysisResult> {
    const defaultPrompt = `
Analyze this IoT sensor data and any provided media files. Look for:
- Unusual patterns or anomalies
- Correlations between different sensors
- Potential issues or maintenance needs
- Optimization opportunities
- Safety concerns

Sensor Data: ${JSON.stringify(sensorData, null, 2)}

${customPrompt ? `Additional Context: ${customPrompt}` : ''}
`;

    return this.analyzeContent({
      prompt: defaultPrompt,
      files,
      context: 'IoT Data Analysis'
    });
  }

  public getSupportedFormats(): string[] {
    return Array.from(this.supportedFormats);
  }

  public getMaxFileSize(): number {
    return this.maxFileSize;
  }

  public getConfiguration() {
    return {
      available: this.isAvailable(),
      model: process.env.GEMINI_MODEL || 'gemini-1.5-pro-latest',
      supportedFormats: this.getSupportedFormats(),
      maxFileSize: this.maxFileSize,
      maxFileSizeFormatted: this.formatFileSize(this.maxFileSize)
    };
  }

  private formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(unitIndex > 0 ? 1 : 0)}${units[unitIndex]}`;
  }
}

// Singleton instance
export const geminiService = new GeminiService();
