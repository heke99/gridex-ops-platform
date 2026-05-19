'use client'

import { useMemo, useRef, useState, type ChangeEvent } from 'react'

type TestCaseOption = {
 value: string
 label: string
}

type EncodedUploadFile = {
 fileName: string
 type: string
 size: number
 base64: string
}

type Props = {
 action: (formData: FormData) => void | Promise<void>
 sourceMessageId: string
 testSuite: string
 roleCode: string
 defaultTestCaseCode?: string | null
 defaultTitle?: string | null
 options: TestCaseOption[]
}

function fileToBase64(file: File): Promise<EncodedUploadFile> {
 return new Promise((resolve, reject) => {
 const reader = new FileReader()

 reader.onerror = () => reject(new Error(`Kunde inte läsa filen ${file.name}.`))
 reader.onload = () => {
 const result = String(reader.result ?? '')
 const base64 = result.includes(',') ? result.split(',').pop() ?? '' : result

 resolve({
 fileName: file.name,
 type: file.type || 'application/octet-stream',
 size: file.size,
 base64,
 })
 }

 reader.readAsDataURL(file)
 })
}

export default function InboundTestDataUploadForm({
 action,
 sourceMessageId,
 testSuite,
 roleCode,
 defaultTestCaseCode,
 defaultTitle,
 options,
}: Props) {
 const [encodedFilesJson, setEncodedFilesJson] = useState('')
 const encodedFilesJsonRef = useRef('')
 const [fileStatus, setFileStatus] = useState('Ingen fil vald.')
 const [isReadingFiles, setIsReadingFiles] = useState(false)

 const uniqueOptions = useMemo(() => {
 const seen = new Set<string>()
 return options.filter((option) => {
 if (!option.value || seen.has(option.value)) return false
 seen.add(option.value)
 return true
 })
 }, [options])


 async function submitWithEncodedFiles(formData: FormData) {
 const encodedJson = encodedFilesJsonRef.current || encodedFilesJson

 // Next/server actions can sometimes receive native file inputs as empty
 // application/octet-stream blobs. The browser-read base64 payload is the
 // canonical upload path for this form, so force it into the FormData at
 // submit time instead of relying only on a hidden input state update.
 formData.set('uploadedFilesJson', encodedJson)

 await action(formData)
 }

 async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
 const files = Array.from(event.target.files ?? [])
 encodedFilesJsonRef.current = ''
 setEncodedFilesJson('')

 if (files.length === 0) {
 setFileStatus('Ingen fil vald.')
 return
 }

 setIsReadingFiles(true)
 setFileStatus(`Läser ${files.length} fil${files.length === 1 ? '' : 'er'} i webbläsaren…`)

 try {
 const encoded = await Promise.all(files.map(fileToBase64))
 const encodedJson = JSON.stringify(encoded)
 encodedFilesJsonRef.current = encodedJson
 setEncodedFilesJson(encodedJson)
 setFileStatus(
 `Redo att skicka: ${encoded
 .map((file) => `${file.fileName} (${Math.ceil(file.size / 1024)} kB)`)
 .join(', ')}`
 )
 } catch (error) {
 encodedFilesJsonRef.current = ''
 setEncodedFilesJson('')
 setFileStatus(error instanceof Error ? error.message : 'Kunde inte läsa vald fil.')
 } finally {
 setIsReadingFiles(false)
 }
 }

 return (
 <form action={submitWithEncodedFiles} className="mt-3 grid gap-2 md:grid-cols-2">
 <input type="hidden" name="sourceMessageId" value={sourceMessageId} />
 <input type="hidden" name="testSuite" value={testSuite} />
 <input type="hidden" name="roleCode" value={roleCode} />
 <input type="hidden" name="uploadedFilesJson" value={encodedFilesJson} />

 <label className="text-xs font-semibold text-slate-700">
 Testfall
 <select
 name="testCaseCode"
 defaultValue={defaultTestCaseCode ?? ''}
 className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-2 py-2 text-xs text-slate-950"
 >
 <option value="">Välj testfall…</option>
 {uniqueOptions.map((option) => (
 <option key={option.value} value={option.value}>
 {option.label}
 </option>
 ))}
 </select>
 </label>

 <label className="text-xs font-semibold text-slate-700">
 Rubrik
 <input
 name="title"
 defaultValue={defaultTitle ?? ''}
 placeholder="t.ex. 2.2.1 Z06F felaktigt anläggningsid"
 className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-2 py-2 text-xs text-slate-950"
 />
 </label>

 <label className="text-xs font-semibold text-slate-700 md:col-span-2">
 Ladda upp Excel/CSV från Edielportalen
 <input
 name="testDataFile"
 type="file"
 multiple
 accept=".xlsx,.csv,.tsv,.txt,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
 onChange={handleFileChange}
 className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-2 py-2 text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-700 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
 />
 </label>

 <div className="md:col-span-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-[11px] leading-5 text-emerald-900">
 {fileStatus}
 </div>

 <textarea
 name="rawText"
 rows={5}
 placeholder={'Eller klistra in testdata, t.ex.\n209 Anläggningsid\t735999888000000017\n218 Antal siffror, mätare\t6'}
 className="md:col-span-2 w-full rounded-xl border border-slate-300 bg-white px-2 py-2 font-mono text-xs text-slate-950"
 />

 <button
 type="submit"
 disabled={isReadingFiles}
 className="w-fit rounded-xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400"
 >
 {isReadingFiles ? 'Läser fil…' : 'Spara och jämför med detta inbound'}
 </button>

 <p className="md:col-span-2 text-[11px] leading-5 text-slate-700">
 Filen läses först i webbläsaren och skickas som kodad data till backend. Det gör att .xlsx, CSV och TXT fungerar även när Next server action tar emot vanliga filfält som tomma blobbar.
 </p>
 </form>
 )
}
