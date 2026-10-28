fn main() {
    let protoc = protoc_bin_vendored::protoc_bin_path()
        .expect("falha ao localizar o binário do protoc vendorizado");

    std::env::set_var("PROTOC", protoc);

    println!("cargo:rerun-if-changed=../proto/telemetria.proto");

    tonic_build::configure()
        .build_server(true)
        .build_client(true)
        .compile_protos(&["../proto/telemetria.proto"], &["../proto"])
        .expect("falha ao compilar ../proto/telemetria.proto");
}
