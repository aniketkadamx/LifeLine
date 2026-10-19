import * as React from "react";
import {
  FileText,
  Upload,
  Download,
  FileCheck2,
  Loader2,
  Search,
  Plus,
  Info,
  Calendar,
  Tag,
} from "lucide-react";
import { api, ApiError } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { EmptyState, ErrorAlert } from "@/components/ui/feedback-states";

export type MedicalRecordType =
  | "LAB_REPORT"
  | "PRESCRIPTION"
  | "XRAY"
  | "MRI"
  | "CT_SCAN"
  | "OTHER";

export interface RegisteredMedicalRecord {
  id: string;
  title: string;
  recordType: MedicalRecordType;
  fileName: string;
  fileType: string;
  sizeBytes: number;
  recordDate: string;
  description?: string;
  storageKey: string;
  createdAt?: string;
}

export interface UploadUrlResponse {
  success: boolean;
  data: {
    uploadUrl: string;
    storageKey: string;
    expiresInSeconds: number;
    method: "PUT";
    headers: {
      "Content-Type": string;
    };
  };
}

export interface CreateRecordResponse {
  success: boolean;
  data: {
    _id?: string;
    id?: string;
    title: string;
    recordType: MedicalRecordType;
    fileName: string;
    fileType: string;
    sizeBytes: number;
    recordDate: string;
    description?: string;
    storageKey: string;
  };
}

export interface DownloadUrlResponse {
  success: boolean;
  data: {
    downloadUrl: string;
    expiresInSeconds: number;
    recordId: string;
    fileName: string;
    fileType: string;
    sizeBytes: number;
  };
}

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "application/dicom",
];
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MiB

export function RecordsPage() {
  const [sessionRecords, setSessionRecords] = React.useState<RegisteredMedicalRecord[]>([]);
  const [isUploadModalOpen, setIsUploadModalOpen] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  // Upload Form State
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [recordTitle, setRecordTitle] = React.useState("");
  const [recordType, setRecordType] = React.useState<MedicalRecordType>("LAB_REPORT");
  const [recordDate, setRecordDate] = React.useState<string>(() => new Date().toISOString().split("T")[0]);
  const [recordDescription, setRecordDescription] = React.useState("");
  const [isUploading, setIsUploading] = React.useState(false);
  const [uploadProgressText, setUploadProgressText] = React.useState<string | null>(null);

  // On-demand lookup state
  const [lookupId, setLookupId] = React.useState("");
  const [isLookingUp, setIsLookingUp] = React.useState(false);
  const [downloadNotice, setDownloadNotice] = React.useState<string | null>(null);

  // File validation
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMsg(null);
    const file = e.target.files?.[0];
    if (!file) {
      setSelectedFile(null);
      return;
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      setErrorMsg(
        `Invalid file type '${file.type || "unknown"}'. Permitted clinical formats: PDF, PNG, JPEG, DICOM.`
      );
      setSelectedFile(null);
      return;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setErrorMsg("File exceeds the maximum permitted limit of 15 MiB.");
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
    if (!recordTitle) {
      setRecordTitle(file.name.replace(/\.[^/.]+$/, ""));
    }
  };

  // Upload workflow
  const handleUploadRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setErrorMsg("Please select a valid medical document to upload.");
      return;
    }
    if (!recordTitle.trim() || recordTitle.trim().length < 3) {
      setErrorMsg("Title must be at least 3 characters long.");
      return;
    }

    setIsUploading(true);
    setErrorMsg(null);

    try {
      // Step 1: Request pre-signed S3 upload URL
      setUploadProgressText("Authorizing secure clinical upload...");
      const uploadUrlRes = await api.post<UploadUrlResponse>(
        "/medical-records/upload-url",
        {
          fileName: selectedFile.name,
          fileType: selectedFile.type,
          sizeBytes: selectedFile.size,
        }
      );

      const { uploadUrl, storageKey } = uploadUrlRes.data;

      // Step 2: Direct-to-cloud PUT upload
      setUploadProgressText("Transferring encrypted file to secure storage...");
      const s3UploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": selectedFile.type,
        },
        body: selectedFile,
      });

      if (!s3UploadRes.ok) {
        throw new Error(
          `Cloud storage rejected document transfer with status ${s3UploadRes.status}.`
        );
      }

      // Step 3: Register metadata in MongoDB
      setUploadProgressText("Registering document metadata & clinical verification...");
      const recordDateTime = new Date(`${recordDate}T00:00:00Z`).toISOString();

      const createRes = await api.post<CreateRecordResponse>("/medical-records", {
        title: recordTitle.trim(),
        recordType,
        storageKey,
        recordDate: recordDateTime,
        description: recordDescription.trim() || undefined,
        fileName: selectedFile.name,
      });

      const newRecord: RegisteredMedicalRecord = {
        id: createRes.data.id || createRes.data._id || storageKey,
        title: createRes.data.title,
        recordType: createRes.data.recordType,
        fileName: createRes.data.fileName,
        fileType: createRes.data.fileType,
        sizeBytes: createRes.data.sizeBytes,
        recordDate: createRes.data.recordDate,
        description: createRes.data.description,
        storageKey: createRes.data.storageKey,
        createdAt: new Date().toISOString(),
      };

      setSessionRecords((prev) => [newRecord, ...prev]);
      setIsUploadModalOpen(false);
      setSelectedFile(null);
      setRecordTitle("");
      setRecordDescription("");
      setDownloadNotice(`Document '${newRecord.title}' successfully registered with ID: ${newRecord.id}`);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setErrorMsg(err.message || "Failed to upload and register medical record.");
      } else if (err instanceof Error) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg("An unexpected failure occurred during medical record upload.");
      }
    } finally {
      setIsUploading(false);
      setUploadProgressText(null);
    }
  };

  // On-demand expiring download URL retrieval
  const handleRequestDownload = async (recordId: string, recordTitle: string) => {
    setErrorMsg(null);
    setDownloadNotice(null);

    try {
      const res = await api.get<DownloadUrlResponse>(
        `/medical-records/${recordId}/download-url`
      );

      const { downloadUrl, expiresInSeconds } = res.data;

      // Note: Never store downloadUrl in persistent storage
      // Open in secure new tab or trigger browser download
      window.open(downloadUrl, "_blank", "noopener,noreferrer");

      setDownloadNotice(
        `Temporary access link generated for '${recordTitle}'. Link expires in ${Math.round(
          expiresInSeconds / 60
        )} minutes.`
      );
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 403) {
          setErrorMsg("Access Denied: You do not have permission to view or download this medical record.");
        } else if (err.status === 404) {
          setErrorMsg("Medical record not found or has been archived.");
        } else {
          setErrorMsg(err.message || "Unable to generate secure download capability.");
        }
      } else {
        setErrorMsg("Failed to request download authorization.");
      }
    }
  };

  // ID lookup
  const handleLookupRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lookupId.trim()) return;

    if (!/^[0-9a-fA-F]{24}$/.test(lookupId.trim())) {
      setErrorMsg("Invalid record ID format. Medical record IDs are 24-character hexadecimal strings.");
      return;
    }

    setIsLookingUp(true);
    setErrorMsg(null);
    setDownloadNotice(null);

    try {
      // Verify download capability directly
      const res = await api.get<DownloadUrlResponse>(
        `/medical-records/${lookupId.trim()}/download-url`
      );

      const record: RegisteredMedicalRecord = {
        id: res.data.recordId,
        title: res.data.fileName || `Record ${res.data.recordId.slice(-6)}`,
        recordType: "OTHER",
        fileName: res.data.fileName,
        fileType: res.data.fileType,
        sizeBytes: res.data.sizeBytes,
        recordDate: new Date().toISOString(),
        storageKey: "",
      };

      // Add to session list if not already present
      setSessionRecords((prev) => {
        if (prev.some((r) => r.id === record.id)) return prev;
        return [record, ...prev];
      });

      window.open(res.data.downloadUrl, "_blank", "noopener,noreferrer");
      setDownloadNotice(`Retrieved record ${record.id}. Download window opened.`);
      setLookupId("");
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 403) {
          setErrorMsg("Access Denied: You are not authorized to view this record ID.");
        } else if (err.status === 404) {
          setErrorMsg(`Medical record '${lookupId.trim()}' was not found in the platform database.`);
        } else {
          setErrorMsg(err.message || "Unable to lookup record.");
        }
      } else {
        setErrorMsg("Network error looking up record.");
      }
    } finally {
      setIsLookingUp(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="records-page">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Medical Records & Diagnostics
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Secure, end-to-end encrypted storage for lab reports, clinical scans, and digital documents.
          </p>
        </div>

        <Button
          onClick={() => setIsUploadModalOpen(true)}
          data-testid="upload-record-button"
        >
          <Plus className="size-4 mr-1.5" /> Upload Document
        </Button>
      </div>

      {/* BACKEND ARCHITECTURE LIMITATION NOTICE */}
      <div className="rounded-xl border border-blue-200 bg-blue-50/60 dark:border-blue-900/60 dark:bg-blue-950/30 p-4 text-xs text-blue-900 dark:text-blue-200 flex items-start gap-3">
        <Info className="size-4 shrink-0 text-blue-600 dark:text-blue-400 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold">Patient Privacy & Session Scope</p>
          <p className="text-blue-800/90 dark:text-blue-300/90">
            For zero-trust security and data privacy, the LifeLine backend does not expose a public list-all endpoint for medical records. The records shown below represent files registered during your current browser session or retrieved via individual record ID lookup.
          </p>
        </div>
      </div>

      {/* FEEDBACK ALERTS */}
      {errorMsg && (
        <ErrorAlert
          title="Medical Record Notice"
          message={errorMsg}
          onRetry={() => setErrorMsg(null)}
          data-testid="records-error-alert"
        />
      )}

      {downloadNotice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3.5 text-xs text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileCheck2 className="size-4 text-emerald-600" />
            <span>{downloadNotice}</span>
          </div>
          <button
            type="button"
            className="text-emerald-700 hover:text-emerald-900 font-semibold"
            onClick={() => setDownloadNotice(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* RECORD ID DIRECT LOOKUP BAR */}
      <Card className="border border-border shadow-xs">
        <CardContent className="p-4 sm:p-5">
          <form onSubmit={handleLookupRecord} className="flex flex-col sm:flex-row items-center gap-3">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Enter 24-character Medical Record ID to lookup and download..."
                className="pl-9 font-mono text-xs"
                value={lookupId}
                onChange={(e) => setLookupId(e.target.value)}
                data-testid="record-lookup-input"
              />
            </div>
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              disabled={isLookingUp || !lookupId.trim()}
              className="w-full sm:w-auto"
              data-testid="record-lookup-submit"
            >
              {isLookingUp ? (
                <>
                  <Loader2 className="size-3.5 mr-1.5 animate-spin" /> Verifying...
                </>
              ) : (
                <>
                  <Download className="size-3.5 mr-1.5" /> Lookup & Download
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* RECORDS LIST OR EMPTY STATE */}
      {sessionRecords.length === 0 ? (
        <EmptyState
          title="No Medical Records in Current Session"
          description="You haven't uploaded or looked up any records in this active session. Upload clinical documents or enter a known Record ID above to generate temporary download capabilities."
          icon={FileText}
          actionLabel="Upload Medical Record"
          onAction={() => setIsUploadModalOpen(true)}
          data-testid="records-empty-state"
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="records-grid">
          {sessionRecords.map((record) => (
            <Card key={record.id} className="border border-border hover:shadow-xs transition-shadow">
              <CardHeader className="p-4 pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <FileText className="size-5" />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-bold text-foreground">
                        {record.title}
                      </CardTitle>
                      <CardDescription className="text-xs text-muted-foreground truncate max-w-[200px]">
                        {record.fileName}
                      </CardDescription>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px] uppercase font-bold tracking-wider">
                    {record.recordType.replace("_", " ")}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="p-4 pt-2 text-xs space-y-2">
                {record.description && (
                  <p className="text-muted-foreground line-clamp-2">
                    {record.description}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground pt-1 border-t border-border/60">
                  <span className="flex items-center gap-1 font-mono text-[11px]">
                    <Tag className="size-3" /> {record.id.slice(-8)}
                  </span>
                  <span>
                    {(record.sizeBytes / (1024 * 1024)).toFixed(2)} MB
                  </span>
                  <span className="flex items-center gap-1">
                    <Calendar className="size-3" />{" "}
                    {new Date(record.recordDate).toLocaleDateString()}
                  </span>
                </div>
              </CardContent>

              <CardFooter className="p-4 pt-0">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => handleRequestDownload(record.id, record.title)}
                  data-testid={`download-record-${record.id}`}
                >
                  <Download className="size-3.5 mr-1.5" /> Request Temporary Download URL
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      {/* UPLOAD MODAL */}
      <Dialog open={isUploadModalOpen} onOpenChange={setIsUploadModalOpen}>
        <DialogContent className="max-w-md p-6 border border-border shadow-xl rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">Upload Medical Document</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Direct-to-cloud encrypted transfer. Permitted formats: PDF, PNG, JPEG, DICOM (max 15 MB).
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleUploadRecord} className="space-y-4 pt-2">
            {/* File Input */}
            <div className="space-y-1.5">
              <Label htmlFor="record-file" className="text-xs font-semibold">
                Select File *
              </Label>
              <Input
                id="record-file"
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.dcm,application/pdf,image/png,image/jpeg,application/dicom"
                onChange={handleFileChange}
                disabled={isUploading}
                data-testid="file-upload-input"
              />
              {selectedFile && (
                <p className="text-[11px] text-muted-foreground">
                  {selectedFile.name} ({(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)
                </p>
              )}
            </div>

            {/* Document Title */}
            <div className="space-y-1.5">
              <Label htmlFor="record-title" className="text-xs font-semibold">
                Document Title *
              </Label>
              <Input
                id="record-title"
                placeholder="e.g. Blood Panel Results, Knee MRI"
                value={recordTitle}
                onChange={(e) => setRecordTitle(e.target.value)}
                disabled={isUploading}
                data-testid="record-title-input"
              />
            </div>

            {/* Record Type */}
            <div className="space-y-1.5">
              <Label htmlFor="record-type" className="text-xs font-semibold">
                Clinical Category *
              </Label>
              <select
                id="record-type"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={recordType}
                onChange={(e) => setRecordType(e.target.value as MedicalRecordType)}
                disabled={isUploading}
              >
                <option value="LAB_REPORT">Lab Report</option>
                <option value="PRESCRIPTION">Prescription</option>
                <option value="XRAY">X-Ray</option>
                <option value="MRI">MRI</option>
                <option value="CT_SCAN">CT Scan</option>
                <option value="OTHER">Other Diagnostics</option>
              </select>
            </div>

            {/* Date */}
            <div className="space-y-1.5">
              <Label htmlFor="record-date" className="text-xs font-semibold">
                Date of Examination *
              </Label>
              <Input
                id="record-date"
                type="date"
                value={recordDate}
                onChange={(e) => setRecordDate(e.target.value)}
                disabled={isUploading}
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label htmlFor="record-desc" className="text-xs font-semibold">
                Clinical Notes / Comments
              </Label>
              <textarea
                id="record-desc"
                rows={2}
                value={recordDescription}
                onChange={(e) => setRecordDescription(e.target.value)}
                placeholder="Optional physician remarks or symptoms..."
                disabled={isUploading}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            {uploadProgressText && (
              <div className="rounded-lg bg-muted/60 p-2.5 text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 className="size-3.5 animate-spin text-primary" />
                <span>{uploadProgressText}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isUploading}
                onClick={() => setIsUploadModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isUploading || !selectedFile || recordTitle.trim().length < 3}
                data-testid="submit-upload-record"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="size-4 mr-1.5 animate-spin" /> Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="size-4 mr-1.5" /> Upload Document
                  </>
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
