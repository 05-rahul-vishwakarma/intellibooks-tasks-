import { v2 as cloudinary } from "cloudinary";
import { Readable } from "stream";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export async function uploadBuffer(
  buffer: Buffer,
  filename: string,
  mimetype: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: "raw",
        public_id: `intellibooks/${Date.now()}-${filename.replace(/\s+/g, "_")}`,
      },
      (error: any, result: any) => {
        if (error) return reject(error);
        resolve(result?.secure_url as string);
      }
    );
    Readable.from([buffer]).pipe(stream);
  });
}

export { cloudinary };
