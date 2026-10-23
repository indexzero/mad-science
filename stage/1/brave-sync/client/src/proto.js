import protobuf from 'protobufjs/light.js';
import Long from 'long';
import descriptor from './proto/sync_pb.json' with { type: 'json' };

protobuf.util.Long = Long;
protobuf.configure();

const root = protobuf.Root.fromJSON(descriptor);

export const ClientToServerMessage = root.lookupType('sync_pb.ClientToServerMessage');
export const ClientToServerResponse = root.lookupType('sync_pb.ClientToServerResponse');
export const EntitySpecifics = root.lookupType('sync_pb.EntitySpecifics');
export const EncryptionKeys = root.lookupType('sync_pb.EncryptionKeys');

export function encode(type, object) {
  const message = type.fromObject(object);
  const problem = type.verify(message);
  if (problem) throw new TypeError(`${type.name}: ${problem}`);
  return type.encode(message).finish();
}

export function decode(type, bytes) {
  return type.toObject(type.decode(bytes), {
    longs: String,
    enums: String,
    bytes: String,
    oneofs: true,
  });
}

export function tokenMtime(token) {
  if (!token) return null;
  const bytes = protobuf.util.newBuffer(protobuf.util.base64.length(token));
  protobuf.util.base64.decode(token, bytes, 0);
  return protobuf.Reader.create(bytes).sint64().toString();
}
